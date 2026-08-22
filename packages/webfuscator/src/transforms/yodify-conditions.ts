import type { Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { isLiteralShaped } from '../utils/literal'

/**
 * Moves a safe literal-shaped right operand to the left of a comparison.
 * Relational operators are flipped after swapping.
 *
 * Unary operations over literals also count when their coercion cannot act.
 *
 * @example
 * // ◀️ before
 * if (x === 1) {}
 * if (name !== "foo") {}
 * if (count > 5) {}
 * if (idx <= 10) {}
 *
 * // ▶️ after
 * if (1 === x) {}
 * if ("foo" !== name) {}
 * if (5 < count) {}
 * if (10 >= idx) {}
 */
export function yodifyConditions(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  BinaryExpression(path, state) {
    const node = path.node
    const op = node.operator
    if (!isComparisonOp(op)) {
      return
    }
    if (!t.isExpression(node.left)) {
      return
    }
    if (isLiteralShaped(node.left)) {
      return
    }
    // The moved right side must run no user code, including object coercion.
    if (!swappingRightIsEffectFree(node.right)) {
      return
    }
    // Relational comparison coerces left first, so a regexp operand cannot swap.
    if (RELATIONAL_FLIP[op] !== undefined && containsRegExpLiteral(node.right)) {
      return
    }

    const left = node.left
    const right = node.right
    node.left = right
    node.right = left
    const flipped = RELATIONAL_FLIP[op]
    if (flipped !== undefined) {
      node.operator = flipped
    }
    state.changed = true
  },
}

const COMPARISON_OPS = new Set<string>(['==', '!=', '===', '!==', '<', '<=', '>', '>='])

function isComparisonOp(op: string): boolean {
  return COMPARISON_OPS.has(op)
}

const RELATIONAL_FLIP: Record<string, t.BinaryExpression['operator']> = {
  '<': '>',
  '>': '<',
  '<=': '>=',
  '>=': '<=',
}

// Numeric unary over regexp invokes ToPrimitive and cannot move earlier.
function swappingRightIsEffectFree(node: t.Expression): boolean {
  return isLiteralShaped(node) && !numericUnaryCoercesRegExp(node)
}

// `!` only propagates risk because ToBoolean never invokes object coercion.
function numericUnaryCoercesRegExp(node: t.Node): boolean {
  if (!t.isUnaryExpression(node) || !t.isExpression(node.argument)) {
    return false
  }
  if (node.operator === '!') {
    return numericUnaryCoercesRegExp(node.argument)
  }
  return t.isRegExpLiteral(node.argument) || numericUnaryCoercesRegExp(node.argument)
}

function containsRegExpLiteral(node: t.Expression): boolean {
  if (t.isRegExpLiteral(node)) {
    return true
  }
  if (t.isUnaryExpression(node) && t.isExpression(node.argument)) {
    return containsRegExpLiteral(node.argument)
  }
  return false
}
