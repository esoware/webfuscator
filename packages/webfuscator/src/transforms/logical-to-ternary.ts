import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isPure } from '../analysis/purity'
import { isInsideWith } from '../utils/ast'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { lowerLogicalWriteStatement } from '../utils/logical-lowering'

/**
 * Rewrites logical expressions as guarded assignments or ternaries. A
 * side-effectful left side is cached in the ternary test for later hoisting.
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
 * f((_t = get()) != null ? _t : fallback);
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
  // `with` can turn repeated names into getters and shadow a cache temp.
  if (isInsideWith(path)) {
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
  if (isPure(leftPath.node, scope, leftPath)) {
    testSrc = node.left
    valueSrc = t.cloneNode(node.left)
  } else {
    const tmp = scope.generateUidIdentifierBasedOnNode(node.left)
    scope.push({ id: t.cloneNode(tmp) })
    testSrc = t.assignmentExpression('=', t.cloneNode(tmp), node.left)
    valueSrc = t.cloneNode(tmp)
  }

  const test: t.Expression =
    op === '??' ? t.binaryExpression('!=', testSrc, t.nullLiteral()) : testSrc

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
  return t.binaryExpression('==', target, t.nullLiteral())
}
