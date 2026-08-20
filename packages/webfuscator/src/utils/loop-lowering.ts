import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'

/**
 * Collects labels whose body is this loop. Their `continue` statements must be
 * redirected after lowering. A hoisted initializer belongs outside the
 * outermost label.
 */
export function collectLoopLabels(path: NodePath<t.Statement>): {
  outermost: NodePath<t.Statement>
  ourLabels: Set<string>
} {
  const ourLabels = new Set<string>()
  let outermost: NodePath<t.Statement> = path
  for (;;) {
    const parent = outermost.parentPath
    if (!parent?.isLabeledStatement() || parent.node.body !== outermost.node) {
      break
    }
    outermost = parent
    ourLabels.add(parent.node.label.name)
  }
  return { outermost, ourLabels }
}

/**
 * Generates an inner-block label after reserving labels above and inside the
 * loop. `scope.generateUid` alone can miss an enclosing user label.
 */
export function generateLoopLabel(path: NodePath<t.Statement>, hint: string): string {
  const taken = new Set<string>()
  let ancestor: NodePath | null = path.parentPath
  while (ancestor) {
    if (ancestor.isLabeledStatement()) {
      taken.add(ancestor.node.label.name)
    }
    ancestor = ancestor.parentPath
  }
  path.traverse({
    LabeledStatement(inner) {
      taken.add(inner.node.label.name)
    },
  })
  // `generateUid` supplies its own counter, even after stripping hint digits.
  let name = path.scope.generateUid(hint)
  while (taken.has(name)) {
    name = path.scope.generateUid(hint)
  }
  return name
}

/**
 * Redirects this loop's `continue` statements to the lowered inner block.
 * Nested loops, other labels, and nested functions stay untouched. The count
 * lets callers omit an unused label.
 */
export function redirectContinues(
  rootPath: NodePath,
  innerLabel: string,
  ourLabels: Set<string>,
): number {
  const state: RedirectState = { count: 0, innerLabel, ourLabels, rootPath }
  rootPath.traverse(redirectVisitor, state)
  return state.count
}

interface RedirectState {
  count: number
  innerLabel: string
  ourLabels: Set<string>
  rootPath: NodePath
}

const redirectVisitor: Visitor<RedirectState> = {
  Function(path) {
    path.skip()
  },
  ContinueStatement(path, state) {
    const { label } = path.node
    if (!label) {
      if (!hasInterposedLoop(path, state.rootPath)) {
        path.replaceWith(t.breakStatement(t.identifier(state.innerLabel)))
        state.count++
      }
      return
    }
    if (state.ourLabels.has(label.name)) {
      path.replaceWith(t.breakStatement(t.identifier(state.innerLabel)))
      state.count++
    }
  },
}

function hasInterposedLoop(path: NodePath, rootPath: NodePath): boolean {
  let current: NodePath | null = path.parentPath
  while (current && current !== rootPath) {
    if (
      current.isForStatement() ||
      current.isForInStatement() ||
      current.isForOfStatement() ||
      current.isWhileStatement() ||
      current.isDoWhileStatement()
    ) {
      return true
    }
    current = current.parentPath
  }
  return false
}
