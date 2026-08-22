import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isInsideWith } from '../utils/ast'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Rewrites `||=`/`&&=`/`??=` as `LHS op (LHS = RHS)`. Member objects and
 * computed keys are cached so the read and write use the same receiver.
 *
 * @example
 * // ◀️ before
 * a ||= b;
 * a &&= b;
 * a ??= b;
 * obj.x ||= y;
 * arr[idx()] ??= v;
 *
 * // ▶️ after
 * a || (a = b);
 * a && (a = b);
 * a ?? (a = b);
 * (_obj = obj).x || (_obj.x = y);
 * (_arr = arr)[_idx = idx()] ?? (_arr[_idx] = v);
 */
export function expandLogicalAssignment(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  AssignmentExpression(path, state) {
    if (lowerLogicalAssignment(path)) {
      state.changed = true
    }
  },
}

function lowerLogicalAssignment(path: NodePath<t.AssignmentExpression>): boolean {
  const operator = path.node.operator
  const left = path.node.left
  const right = path.node.right
  if (operator.length < 2) {
    return false
  }
  const op = operator.slice(0, -1)
  if (op !== '||' && op !== '&&' && op !== '??') {
    return false
  }

  const lhs = t.cloneNode(left, true)

  if (t.isMemberExpression(left) && t.isMemberExpression(lhs)) {
    // `with` can turn a bare object name into a getter or shadow a memo temp.
    if (isInsideWith(path)) {
      return false
    }
    const object = left.object
    if (t.isExpression(object)) {
      const memo = path.scope.maybeGenerateMemoised(object)
      if (memo) {
        left.object = memo
        lhs.object = t.assignmentExpression('=', t.cloneNode(memo), object)
      }
    }

    if (left.computed) {
      const property = left.property
      if (t.isExpression(property)) {
        const memoProp = path.scope.maybeGenerateMemoised(property)
        if (memoProp) {
          left.property = memoProp
          lhs.property = t.assignmentExpression('=', t.cloneNode(memoProp), property)
        }
      }
    }
  } else if (!t.isIdentifier(left)) {
    return false
  }

  path.replaceWith(
    t.logicalExpression(op, lhs as t.Expression, t.assignmentExpression('=', left, right)),
  )
  return true
}
