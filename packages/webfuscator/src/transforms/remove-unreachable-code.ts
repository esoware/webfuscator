import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Removes statements after unconditional control flow in the same statement list.
 *
 * Hoisted function and `var` declarations stay because reachable code may still
 * observe their bindings.
 *
 * @example
 * // ◀️ before
 * function foo() {
 *   return "bar";
 *   log("baz");
 * }
 *
 * // ▶️ after
 * function foo() {
 *   return "bar";
 * }
 */
export function removeUnreachableCode(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  BlockStatement(path, state) {
    if (pruneBody(path.get('body'))) {
      state.changed = true
    }
  },
  SwitchCase(path, state) {
    if (pruneBody(path.get('consequent'))) {
      state.changed = true
    }
  },
}

function pruneBody(body: NodePath<t.Statement>[]): boolean {
  let killZone = false
  const toRemove: NodePath<t.Statement>[] = []
  for (const stmt of body) {
    if (killZone) {
      if (isSafeToRemoveAfterCompletion(stmt)) {
        toRemove.push(stmt)
      }
      continue
    }
    if (isCompletion(stmt.node)) {
      killZone = true
    }
  }
  for (const removed of toRemove) {
    removed.remove()
  }
  return toRemove.length > 0
}

function isCompletion(node: t.Node): boolean {
  return (
    t.isReturnStatement(node) ||
    t.isThrowStatement(node) ||
    t.isBreakStatement(node) ||
    t.isContinueStatement(node)
  )
}

function isSafeToRemoveAfterCompletion(path: NodePath<t.Statement>): boolean {
  const node = path.node
  if (t.isFunctionDeclaration(node) || (t.isVariableDeclaration(node) && node.kind === 'var')) {
    return false
  }
  return !nestsHoistedVar(node)
}

function nestsHoistedVar(node: t.Node): boolean {
  let found = false
  t.traverseFast(node, (child) => {
    if (found) {
      return t.traverseFast.skip
    }
    if (child !== node && t.isFunction(child)) {
      return t.traverseFast.skip
    }
    if (t.isVariableDeclaration(child) && child.kind === 'var') {
      found = true
    }
    return found ? t.traverseFast.skip : undefined
  })
  return found
}
