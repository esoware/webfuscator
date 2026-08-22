import type { Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Removes every `debugger` statement.
 *
 * @example
 * // ◀️ before
 * function foo() {
 *   debugger;
 *   return "bar";
 * }
 *
 * // ▶️ after
 * function foo() {
 *   return "bar";
 * }
 */
export function dropDebugger(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  DebuggerStatement(path, state) {
    // Babel cannot remove a required single-statement child. Keep the slot valid
    // with an empty statement.
    if (Array.isArray(path.container)) {
      path.remove()
    } else {
      path.replaceWith(t.emptyStatement())
    }
    state.changed = true
  },
}
