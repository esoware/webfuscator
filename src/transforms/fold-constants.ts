import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { evaluateConstant } from 'src/analysis/constant'
import { isPure } from 'src/analysis/purity'
import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'
import { valueToLiteral } from 'src/utils/literal'
import { isCalleeOrTagOf } from 'src/utils/paths'

/**
 * Folds pure constant expressions to literals via `evaluateConstant`.
 * Logical and conditional nodes can fold directly to a chosen nonliteral branch.
 *
 * @example
 * // ◀️ before
 * var v = 1 + 2 * 3;
 * if (true && cond) f();
 *
 * // ▶️ after
 * var v = 7;
 * if (cond) f();
 */
export function foldConstants(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  UnaryExpression: {
    exit(path, state) {
      if (tryFoldExprNode(path)) {
        state.changed = true
      }
    },
  },
  BinaryExpression: {
    exit(path, state) {
      if (tryFoldExprNode(path)) {
        state.changed = true
      }
    },
  },
  LogicalExpression: {
    exit(path, state) {
      if (tryFoldExprNode(path)) {
        state.changed = true
      }
    },
  },
  ConditionalExpression: {
    exit(path, state) {
      if (tryFoldExprNode(path)) {
        state.changed = true
      }
    },
  },
}

function tryFoldExprNode(path: NodePath): boolean {
  if (path.isUnaryExpression()) {
    return tryFoldToLiteral(path)
  }
  if (path.isBinaryExpression()) {
    if (tryFoldToLiteral(path)) {
      return true
    }
    return tryReassociate(path)
  }
  if (path.isLogicalExpression()) {
    return tryFoldLogical(path)
  }
  if (path.isConditionalExpression()) {
    return tryFoldConditional(path)
  }
  return false
}

function tryFoldLogical(path: NodePath<t.LogicalExpression>): boolean {
  // Folding a callee to a member reference can manufacture a `this` binding.
  if (isCalleeOrTagOf(path) || isReferenceSensitiveUnaryOperand(path)) {
    return false
  }
  const left = evaluateConstant(path.node.left, path.scope, path)
  if (!left.known) {
    return false
  }
  const op = path.node.operator
  let chosen: t.Expression
  if (op === '&&') {
    chosen = left.value ? path.node.right : path.node.left
  } else if (op === '||') {
    chosen = left.value ? path.node.left : path.node.right
  } else if (op === '??') {
    chosen = left.value === null || left.value === undefined ? path.node.right : path.node.left
  } else {
    return false
  }
  path.replaceWith(chosen)
  return true
}

function tryFoldConditional(path: NodePath<t.ConditionalExpression>): boolean {
  if (isCalleeOrTagOf(path) || isReferenceSensitiveUnaryOperand(path)) {
    return false
  }
  const test = evaluateConstant(path.node.test, path.scope, path)
  if (!test.known) {
    return false
  }
  path.replaceWith(test.value ? path.node.consequent : path.node.alternate)
  return true
}

// `delete` and `typeof` distinguish references from values. Folding their operand
// can change deletion, strict syntax, or an unresolved-name exception.
function isReferenceSensitiveUnaryOperand(path: NodePath): boolean {
  const parent = path.parentPath
  return (
    parent != null &&
    parent.isUnaryExpression() &&
    (parent.node.operator === 'delete' || parent.node.operator === 'typeof') &&
    parent.node.argument === path.node
  )
}

function tryFoldToLiteral(
  path: NodePath<t.UnaryExpression> | NodePath<t.BinaryExpression>,
): boolean {
  const result = evaluateConstant(path.node, path.scope, path)
  if (!result.known) {
    return false
  }
  const lit = valueToLiteral(result.value)
  if (!lit) {
    return false
  }
  // Babel revisits replacements, so an identical replacement would loop.
  if (structurallyEqual(path.node, lit)) {
    return false
  }
  path.replaceWith(lit)
  return true
}

type SafeConstant = { kind: 'number'; value: number } | { kind: 'bigint'; value: bigint }

type CommutativeOp = '*' | '&' | '|' | '^'

function tryReassociate(path: NodePath<t.BinaryExpression>): boolean {
  const op = path.node.operator
  if (op === '*' || op === '&' || op === '|' || op === '^') {
    return tryReassociateCommutative(path, op)
  }
  if (op === '-') {
    return tryReassociateSubtract(path)
  }
  return false
}

function tryReassociateCommutative(path: NodePath<t.BinaryExpression>, op: CommutativeOp): boolean {
  const parent = path.parentPath
  if (parent && parent.isBinaryExpression() && parent.node.operator === op) {
    return false
  }

  const leaves: t.Expression[] = []
  collectCommutativeChain(path.node, op, leaves)

  const constants: SafeConstant[] = []
  const others: t.Expression[] = []
  for (const leaf of leaves) {
    const c = asSafeConstant(leaf)
    if (c === null) {
      others.push(leaf)
    } else {
      constants.push(c)
    }
  }
  if (constants.length < 2) {
    return false
  }
  // IEEE-754 multiplication is not associative. BigInt and Int32 bitwise chains
  // are exact, while a wholly constant chain can be evaluated as written.
  if (op === '*' && others.length > 0 && constants.some((c) => c.kind === 'number')) {
    return false
  }
  // Grouping constants can move one operand's coercion past another operand's
  // evaluation. Multiple non-constant operands must therefore be pure.
  if (others.length > 1 && !others.every((leaf) => isPure(leaf, path.scope, path))) {
    return false
  }

  const combined = combineConstants(constants, op)
  if (combined === null) {
    return false
  }
  const combinedLit = constantToLiteral(combined)

  let replacement: t.Expression
  if (others.length === 0) {
    replacement = combinedLit
  } else {
    replacement = others[0]!
    for (let i = 1; i < others.length; i++) {
      replacement = t.binaryExpression(op, replacement, others[i]!)
    }
    replacement = t.binaryExpression(op, replacement, combinedLit)
  }
  path.replaceWith(replacement)
  return true
}

function collectCommutativeChain(
  node: t.BinaryExpression,
  op: CommutativeOp,
  out: t.Expression[],
): void {
  if (t.isBinaryExpression(node.left) && node.left.operator === op) {
    collectCommutativeChain(node.left, op, out)
  } else if (t.isExpression(node.left)) {
    out.push(node.left)
  }
  if (t.isBinaryExpression(node.right) && node.right.operator === op) {
    collectCommutativeChain(node.right, op, out)
  } else {
    out.push(node.right)
  }
}

function tryReassociateSubtract(path: NodePath<t.BinaryExpression>): boolean {
  const parent = path.parentPath
  if (
    parent &&
    parent.isBinaryExpression() &&
    parent.node.operator === '-' &&
    parent.node.left === path.node
  ) {
    return false
  }

  const subtractees: t.Expression[] = []
  let node: t.BinaryExpression = path.node
  while (true) {
    subtractees.unshift(node.right)
    const { left } = node
    if (t.isBinaryExpression(left) && left.operator === '-') {
      node = left
      continue
    }
    break
  }
  if (!t.isExpression(node.left)) {
    return false
  }
  const base = node.left

  const constSubs: SafeConstant[] = []
  const otherSubs: t.Expression[] = []
  for (const subtractee of subtractees) {
    const c = asSafeConstant(subtractee)
    if (c === null) {
      otherSubs.push(subtractee)
    } else {
      constSubs.push(c)
    }
  }

  const baseConst = asSafeConstant(base)
  // IEEE-754 subtraction is not associative. BigInt subtraction is exact.
  if (constSubs.some((c) => c.kind === 'number') || baseConst?.kind === 'number') {
    return false
  }
  if (baseConst !== null) {
    if (constSubs.length === 0) {
      return false
    }
    const combined = combineConstants([baseConst, ...constSubs], '-')
    if (combined === null) {
      return false
    }
    const combinedLit = constantToLiteral(combined)
    let replacement: t.Expression = combinedLit
    for (const other of otherSubs) {
      replacement = t.binaryExpression('-', replacement, other)
    }
    path.replaceWith(replacement)
    return true
  }

  if (constSubs.length < 2) {
    return false
  }
  // Reassociation can move `base` coercion past a subtractee's evaluation.
  // Non-constant subtractees must be pure.
  if (!otherSubs.every((leaf) => isPure(leaf, path.scope, path))) {
    return false
  }
  const sum = combineConstants(constSubs, '+')
  if (sum === null) {
    return false
  }
  const sumLit = constantToLiteral(sum)
  let replacement: t.Expression = base
  for (const other of otherSubs) {
    replacement = t.binaryExpression('-', replacement, other)
  }
  replacement = t.binaryExpression('-', replacement, sumLit)
  path.replaceWith(replacement)
  return true
}

function asSafeConstant(node: t.Node): SafeConstant | null {
  if (t.isNumericLiteral(node)) {
    return Number.isInteger(node.value) && Math.abs(node.value) <= Number.MAX_SAFE_INTEGER
      ? { kind: 'number', value: node.value }
      : null
  }
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
    const negated = -node.argument.value
    return Number.isInteger(negated) && Math.abs(negated) <= Number.MAX_SAFE_INTEGER
      ? { kind: 'number', value: negated }
      : null
  }
  if (t.isBigIntLiteral(node)) {
    try {
      return { kind: 'bigint', value: BigInt(node.value) }
    } catch {
      return null
    }
  }
  return null
}

function constantToLiteral(c: SafeConstant): t.Expression {
  if (c.kind === 'bigint') {
    return c.value < 0n
      ? t.unaryExpression('-', t.bigIntLiteral(-c.value))
      : t.bigIntLiteral(c.value)
  }
  // `t.numericLiteral(-0)` is rejected by Babel's validator; emit `-0`.
  if (Object.is(c.value, -0)) {
    return t.unaryExpression('-', t.numericLiteral(0))
  }
  if (c.value < 0) {
    return t.unaryExpression('-', t.numericLiteral(-c.value))
  }
  return t.numericLiteral(c.value)
}

function isInt32(value: number): boolean {
  return (value | 0) === value
}

function combineConstants(
  consts: SafeConstant[],
  op: CommutativeOp | '-' | '+',
): SafeConstant | null {
  if (consts.length === 0) {
    return null
  }
  const { kind } = consts[0]!
  for (const c of consts) {
    if (c.kind !== kind) {
      return null
    }
  }

  if (kind === 'bigint') {
    let acc = consts[0]!.value as bigint
    for (let i = 1; i < consts.length; i++) {
      const c = consts[i]!.value as bigint
      acc = applyBigint(acc, c, op)
    }
    return { kind: 'bigint', value: acc }
  }

  if (op === '&' || op === '|' || op === '^') {
    for (const c of consts) {
      if (!isInt32(c.value as number)) {
        return null
      }
    }
  }
  let acc = consts[0]!.value as number
  for (let i = 1; i < consts.length; i++) {
    const c = consts[i]!.value as number
    acc = applyNumber(acc, c, op)
  }
  if (!Number.isFinite(acc)) {
    return null
  }
  if (
    (op === '*' || op === '+' || op === '-') &&
    (!Number.isInteger(acc) || Math.abs(acc) > Number.MAX_SAFE_INTEGER)
  ) {
    return null
  }
  return { kind: 'number', value: acc }
}

function applyBigint(a: bigint, b: bigint, op: CommutativeOp | '-' | '+'): bigint {
  switch (op) {
    case '*':
      return a * b
    case '&':
      return a & b
    case '|':
      return a | b
    case '^':
      return a ^ b
    case '-':
      return a - b
    case '+':
      return a + b
  }
}

function applyNumber(a: number, b: number, op: CommutativeOp | '-' | '+'): number {
  switch (op) {
    case '*':
      return a * b
    case '&':
      return a & b
    case '|':
      return a | b
    case '^':
      return a ^ b
    case '-':
      return a - b
    case '+':
      return a + b
  }
}

function structurallyEqual(a: t.Node, b: t.Node): boolean {
  if (a.type !== b.type) {
    return false
  }
  if (t.isNumericLiteral(a) && t.isNumericLiteral(b)) {
    return a.value === b.value
  }
  if (t.isStringLiteral(a) && t.isStringLiteral(b)) {
    return a.value === b.value
  }
  if (t.isBooleanLiteral(a) && t.isBooleanLiteral(b)) {
    return a.value === b.value
  }
  if (t.isNullLiteral(a)) {
    return true
  }
  if (t.isBigIntLiteral(a) && t.isBigIntLiteral(b)) {
    return a.value === b.value
  }
  if (t.isIdentifier(a) && t.isIdentifier(b)) {
    return a.name === b.name
  }
  if (t.isUnaryExpression(a) && t.isUnaryExpression(b)) {
    return a.operator === b.operator && structurallyEqual(a.argument, b.argument)
  }
  return false
}
