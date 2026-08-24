import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from './change-tracking'
import type { ChangeState } from './change-tracking'

export type StatementListContainer = t.Program | t.BlockStatement | t.StaticBlock | t.SwitchCase

type Rewrite = (
  statements: NodePath<t.Statement>[],
  container: NodePath<StatementListContainer>,
) => t.Statement[] | null

/** Applies a rewrite to every statement-list container in the AST. */
export function rewriteStatementLists(ast: File, rewrite: Rewrite): boolean {
  return traverseForChanges(ast, {
    Program(path, state) {
      apply(path, 'body', rewrite, state)
    },
    BlockStatement(path, state) {
      apply(path, 'body', rewrite, state)
    },
    StaticBlock(path, state) {
      apply(path, 'body', rewrite, state)
    },
    SwitchCase(path, state) {
      apply(path, 'consequent', rewrite, state)
    },
  })
}

function apply(
  container: NodePath<StatementListContainer>,
  key: 'body' | 'consequent',
  rewrite: Rewrite,
  state: ChangeState,
): void {
  const statements = container.get(key) as NodePath<t.Statement>[]
  const replacement = rewrite(statements, container)
  if (replacement) {
    container.set(key, replacement)
    state.changed = true
  }
}
