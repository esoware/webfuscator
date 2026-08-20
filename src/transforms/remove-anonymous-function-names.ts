import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'

/**
 * Removes a function expression's name when the body does not use its binding
 * and NamedEvaluation restores the same `.name`. Other positions could infer no
 * name or a different one.
 *
 * @example
 * // ◀️ before
 * var greet = function greet() {};
 * var a = function bar() {};
 *
 * // ▶️ after
 * var greet = function () {};
 * var a = function bar() {};
 */
export function removeAnonymousFunctionNames(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  FunctionExpression(path, state) {
    const { id } = path.node
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
    if (inferredName(path) !== id.name) {
      return
    }
    path.node.id = null
    state.changed = true
  },
}

// No inferred name means `.name` would become empty.
function inferredName(path: NodePath<t.FunctionExpression>): string | null {
  const { node } = path
  const { parentPath } = path
  if (!parentPath) {
    return null
  }
  const parent = parentPath.node
  if (t.isVariableDeclarator(parent) && parent.init === node && t.isIdentifier(parent.id)) {
    return parent.id.name
  }
  if (
    t.isAssignmentExpression(parent) &&
    parent.operator === '=' &&
    parent.right === node &&
    t.isIdentifier(parent.left)
  ) {
    return parent.left.name
  }
  if (t.isAssignmentPattern(parent) && parent.right === node && t.isIdentifier(parent.left)) {
    return parent.left.name
  }
  if (
    (t.isObjectProperty(parent) || t.isClassProperty(parent)) &&
    parent.value === node &&
    !parent.computed
  ) {
    if (t.isIdentifier(parent.key)) {
      return parent.key.name
    }
    if (t.isStringLiteral(parent.key)) {
      return parent.key.value
    }
  }
  return null
}
