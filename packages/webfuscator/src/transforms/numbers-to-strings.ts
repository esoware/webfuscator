import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'

/**
 * Rewrites numeric literals as strings coerced with unary plus. Under `+`, `-`,
 * or `~`, the existing operator supplies that coercion. Other unary operators
 * keep the wrapper because their string behavior differs.
 *
 * Preparation has already converted numeric object keys to strings.
 *
 * @example
 * // ◀️ before
 * var x = arr[42] + 0.5 * 1e3;
 * var y = -5 * ~3;
 *
 * // ▶️ after
 * var x = arr[+"42"] + +"0.5" * +"1000";
 * var y = -"5" * ~"3";
 */
export function numbersToStrings(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const NUMERIC_UNARIES = new Set(['+', '-', '~'])

const visitor: Visitor<ChangeState> = {
  NumericLiteral(path, state) {
    // Non-computed keys are names, and class-field keys can still reach this pass.
    if (isNonComputedKey(path)) {
      return
    }
    const str = t.stringLiteral(String(path.node.value))
    const { parent } = path
    if (
      t.isUnaryExpression(parent) &&
      parent.argument === path.node &&
      NUMERIC_UNARIES.has(parent.operator)
    ) {
      path.replaceWith(str)
    } else {
      path.replaceWith(t.unaryExpression('+', str))
    }
    path.skip()
    state.changed = true
  },
}

function isNonComputedKey(path: NodePath<t.NumericLiteral>): boolean {
  const { parentPath } = path
  if (!parentPath) {
    return false
  }
  const parent = parentPath.node
  return (
    'key' in parent && parent.key === path.node && 'computed' in parent && parent.computed === false
  )
}
