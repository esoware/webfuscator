import traverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isSideEffectFree } from 'src/analysis/purity'
import { isInsideWith } from 'src/utils/ast'
import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'

/**
 * Removes `console.*(...)` expression statements when `console` is not
 * locally shadowed. Matches dot, bracket, and optional-chain forms.
 * Leaves indirect uses alone (`console.log.call(...)`, assignments,
 * `await console.log(...)`).
 *
 * @example
 * // ◀️ before
 * function foo() {
 *   console.log("hi");
 *   return "bar";
 * }
 * function bar(console) {
 *   console.log("kept");
 * }
 *
 * // ▶️ after
 * function foo() {
 *   return "bar";
 * }
 * function bar(console) {
 *   console.log("kept");
 * }
 */
export function dropConsole(ast: File): boolean {
  // A reassigned global `console` can invoke user code.
  if (globalConsoleIsReassigned(ast)) {
    return false
  }
  return traverseForChanges(ast, visitor)
}

function globalConsoleIsReassigned(ast: File): boolean {
  let reassigned = false
  traverse(ast, {
    Identifier(path) {
      if (path.node.name !== 'console' || reassigned) {
        return
      }
      // Per-call checks already handle local shadows.
      if (path.scope.getBinding('console')) {
        return
      }
      if (isWriteTarget(path)) {
        reassigned = true
        path.stop()
      }
    },
  })
  return reassigned
}

function isWriteTarget(path: NodePath<t.Identifier>): boolean {
  const { node, parentPath } = path
  if (!parentPath) {
    return false
  }
  if (parentPath.isAssignmentExpression({ left: node })) {
    return true
  }
  if (parentPath.isUpdateExpression({ argument: node })) {
    return true
  }
  // Destructuring and iterator-loop targets also write the name.
  return path.isBindingIdentifier()
}

const visitor: Visitor<ChangeState> = {
  ExpressionStatement(path, state) {
    const expr = path.node.expression
    if (!t.isCallExpression(expr) && !t.isOptionalCallExpression(expr)) {
      return
    }
    const { callee } = expr
    if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) {
      return
    }
    const { object } = callee
    if (!t.isIdentifier(object) || object.name !== 'console') {
      return
    }
    // `with` can supply a different `console` outside Babel's scope table.
    if (path.scope.getBinding('console') || isInsideWith(path)) {
      return
    }
    // Removing the call also removes argument and computed-key evaluation.
    if (!callArgumentsAreInert(expr, callee, path)) {
      return
    }
    path.remove()
    state.changed = true
  },
}

function callArgumentsAreInert(
  expr: t.CallExpression | t.OptionalCallExpression,
  callee: t.MemberExpression | t.OptionalMemberExpression,
  path: NodePath<t.ExpressionStatement>,
): boolean {
  if (callee.computed && !isSideEffectFree(callee.property, path.scope, path)) {
    return false
  }
  for (const arg of expr.arguments) {
    if (!t.isExpression(arg) || !isSideEffectFree(arg, path.scope, path)) {
      return false
    }
  }
  return true
}
