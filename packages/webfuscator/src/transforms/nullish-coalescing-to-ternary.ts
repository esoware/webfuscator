import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isInsideWith } from '../utils/ast'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { lowerLogicalWriteStatement } from '../utils/logical-lowering'

/**
 * Rewrites `a ?? b` as a guarded assignment or `a != null ? a : b`. A
 * side-effectful left side is cached. Loose inequality checks both nullish
 * values in one comparison.
 *
 * @example
 * // ◀️ before
 * var x = a ?? b;
 * f(get() ?? fallback);
 *
 * // ▶️ after
 * var x = a;
 * if (x == null) x = b;
 * f((_t = get()) != null ? _t : fallback);
 */
export function nullishCoalescingToTernary(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  LogicalExpression(path, state) {
    if (lowerNullishCoalescing(path)) {
      state.changed = true
    }
  },
}

function lowerNullishCoalescing(path: NodePath<t.LogicalExpression>): boolean {
  const node = path.node
  if (node.operator !== '??') {
    return false
  }
  // `with` can turn a repeated name into a getter and shadow a cache temp.
  if (isInsideWith(path)) {
    return false
  }

  if (lowerLogicalWriteStatement(path, nullishFallbackTest)) {
    return true
  }

  const scope = path.scope
  let test: t.Expression
  let consequent: t.Expression

  if (t.isIdentifier(node.left) && scope.hasBinding(node.left.name)) {
    test = node.left
    consequent = t.cloneNode(node.left)
  } else {
    const tmp = scope.generateUidIdentifierBasedOnNode(node.left)
    scope.push({ id: t.cloneNode(tmp) })
    test = t.assignmentExpression('=', t.cloneNode(tmp), node.left)
    consequent = t.cloneNode(tmp)
  }

  path.replaceWith(
    t.conditionalExpression(
      t.binaryExpression('!=', test, t.nullLiteral()),
      consequent,
      node.right,
    ),
  )
  return true
}

function nullishFallbackTest(target: t.Identifier): t.Expression {
  return t.binaryExpression('==', target, t.nullLiteral())
}
