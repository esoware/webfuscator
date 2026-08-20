import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

/**
 * Splits multi-declarator `var`/`let`/`const` into one declarator per statement,
 * preserving the kind. Loop heads and exports stay intact because their parent
 * slots do not accept several statements.
 *
 * @example
 * // ◀️ before
 * var a = 1, b = 2, c;
 * let x = 1, y = 2;
 *
 * // ▶️ after
 * var a = 1;
 * var b = 2;
 * var c;
 * let x = 1;
 * let y = 2;
 */
export function splitVariableDeclarations(ast: File): void {
  traverse(ast, visitor)
}

const visitor = {
  VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
    if (typeof path.listKey !== 'string') {
      return
    }
    if (path.node.declarations.length <= 1) {
      return
    }
    const { kind } = path.node
    const replacements = path.node.declarations.map((decl) => t.variableDeclaration(kind, [decl]))
    path.replaceWithMultiple(replacements)
  },
}
