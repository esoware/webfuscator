import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Expands arithmetic and bitwise compound assignments into simple assignments
 * while preserving single evaluation of member receivers and computed keys.
 *
 * @example
 * // ◀️ before
 * a += b;
 * a **= 2;
 * obj.x -= y;
 * arr[idx()] |= v;
 *
 * // ▶️ after
 * a = a + b;
 * a = a ** 2;
 * (_obj = obj).x = _obj.x - y;
 * (_arr = arr)[_idx = idx()] = _arr[_idx] | v;
 */
export function expandBinaryAssignment(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  AssignmentExpression(path, state) {
    if (lowerBinaryAssignment(path)) {
      state.changed = true
    }
  },
}

const LOGICAL_COMPOUND = new Set(['||', '&&', '??'])

function lowerBinaryAssignment(path: NodePath<t.AssignmentExpression>): boolean {
  const operator = path.node.operator
  const left = path.node.left
  const right = path.node.right
  if (operator === '=' || operator.length < 2) {
    return false
  }
  const op = operator.slice(0, -1)
  if (LOGICAL_COMPOUND.has(op)) {
    return false
  }

  const read = t.cloneNode(left, true)

  if (t.isMemberExpression(left) && t.isMemberExpression(read)) {
    const object = left.object
    if (t.isExpression(object)) {
      const memo = path.scope.maybeGenerateMemoised(object)
      if (memo) {
        read.object = memo
        left.object = t.assignmentExpression('=', t.cloneNode(memo), object)
      }
    }

    if (left.computed) {
      const property = left.property
      if (t.isExpression(property)) {
        const memoProp = path.scope.maybeGenerateMemoised(property)
        if (memoProp) {
          read.property = memoProp
          left.property = t.assignmentExpression('=', t.cloneNode(memoProp), property)
        }
      }
    }
  } else if (!t.isIdentifier(left)) {
    return false
  }

  path.replaceWith(
    t.assignmentExpression(
      '=',
      left,
      t.binaryExpression(op as t.BinaryExpression['operator'], read as t.Expression, right),
    ),
  )
  return true
}
