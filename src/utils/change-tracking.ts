import traverse from '@babel/traverse'
import type { Visitor } from '@babel/traverse'
import type { File } from '@babel/types'

/** Mutable flag a transform's visitor flips when it rewrites a node. */
export interface ChangeState {
  changed: boolean
}

// Babel traversal state carries one fresh change flag through the visitor.
export function traverseForChanges(ast: File, visitor: Visitor<ChangeState>): boolean {
  const state: ChangeState = { changed: false }
  traverse(ast, visitor, undefined, state)
  return state.changed
}
