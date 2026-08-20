import type { Visitor } from '@babel/traverse'
import type { File } from '@babel/types'

import { enclosingScopeHasDirectEval } from 'src/utils/ast'
import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'
import { hasConstantViolation } from 'src/utils/paths'

/**
 * Changes `const` to `let` when no write can observe the lost TypeError. Direct
 * eval and recorded constant violations keep the declaration unchanged. Scope
 * and TDZ behavior are otherwise identical.
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
    if (enclosingScopeHasDirectEval(path) || hasConstantViolation(path)) {
      return
    }
    path.node.kind = 'let'
    state.changed = true
  },
}
