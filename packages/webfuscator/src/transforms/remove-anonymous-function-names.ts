import type { Visitor } from '@babel/traverse'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Removes a function expression's name when its body does not reference it.
 *
 * @example
 * // ◀️ before
 * var greet = function greet() {};
 * var a = function bar() {};
 *
 * // ▶️ after
 * var greet = function () {};
 * var a = function () {};
 */
export function removeAnonymousFunctionNames(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  FunctionExpression(path, state) {
    const id = path.node.id
    if (!id) {
      return
    }
    // Reads and writes both observe the expression's immutable inner binding.
    const binding = path.scope.getBinding(id.name)
    if (
      binding &&
      binding.identifier === id &&
      (binding.references > 0 || binding.constantViolations.length > 0)
    ) {
      return
    }
    path.node.id = null
    state.changed = true
  },
}
