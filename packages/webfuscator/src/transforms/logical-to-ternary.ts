import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isPure } from '../analysis/purity'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { lowerLogicalWriteStatement } from '../utils/logical-lowering'
import { buildNonNullishCheck, buildNullishCheck } from '../utils/nullish'

/**
 * Rewrites logical expressions as equivalent conditional expressions or
 * guarded assignments while preserving short-circuit evaluation.
 *
 * @example
 * // ◀️ before
 * var x = a || b;
 * y = c && d;
 * f(get() ?? fallback);
 *
 * // ▶️ after
 * var x = a;
 * if (!x) x = b;
 * y = c;
 * if (y) y = d;
 * f(((_t = get()) !== null ? _t !== void 0 : false) ? _t : fallback);
 */
export function logicalToTernary(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  LogicalExpression: {
    exit(path, state) {
      if (lowerLogical(path)) {
        state.changed = true
      }
    },
  },
}

function lowerLogical(path: NodePath<t.LogicalExpression>): boolean {
  const node = path.node
  const op = node.operator
  if (op !== '&&' && op !== '||' && op !== '??') {
    return false
  }
  if (lowerLogicalWriteStatement(path, (target) => buildFallbackTest(op, target))) {
    return true
  }

  const scope = path.scope
  const leftPath = path.get('left')
  let testSrc: t.Expression
  let valueSrc: t.Expression

  // Babel purity misses user coercion in unary and binary expressions.
  if (isPure(leftPath.node, scope)) {
    testSrc = node.left
    valueSrc = t.cloneNode(node.left)
  } else {
    const tmp = scope.generateUidIdentifierBasedOnNode(node.left)
    scope.push({ id: t.cloneNode(tmp) })
    testSrc = t.assignmentExpression('=', t.cloneNode(tmp), node.left)
    valueSrc = t.cloneNode(tmp)
  }

  const test: t.Expression =
    op === '??' ? buildNonNullishCheck(testSrc, t.cloneNode(valueSrc)) : testSrc

  path.replaceWith(
    op === '&&'
      ? t.conditionalExpression(test, node.right, valueSrc)
      : t.conditionalExpression(test, valueSrc, node.right),
  )
  return true
}

function buildFallbackTest(op: '&&' | '||' | '??', target: t.Identifier): t.Expression {
  if (op === '||') {
    return t.unaryExpression('!', target)
  }
  if (op === '&&') {
    return target
  }
  return buildNullishCheck(target, t.cloneNode(target))
}
