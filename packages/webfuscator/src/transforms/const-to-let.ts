import type { Visitor } from '@babel/traverse'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { hasConstantViolation } from '../utils/paths'

/**
 * Changes `const` to `let` when Babel finds no writes. Read-only bindings keep
 * the same scope and TDZ behavior; the declarations differ only on writes.
 *
 * @example
 * // ◀️ before
 * const foo = "bar";
 * const { a, b } = obj;
 *
 * // ▶️ after
 * let foo = "bar";
 * let { a, b } = obj;
 */
export function constToLet(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  VariableDeclaration(path, state) {
    if (path.node.kind !== 'const') {
      return
    }
    if (hasConstantViolation(path)) {
      return
    }
    path.node.kind = 'let'
    state.changed = true
  },
}
