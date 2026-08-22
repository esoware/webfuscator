import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Rewrites safe function declarations as `var` initializers. The function value
 * is no longer hoisted, so nothing may observe the binding before assignment.
 *
 * Preceding statements must be inert. Name inference and recursive references
 * still use the `var` binding.
 *
 * Block-level declarations and module top-level declarations stay unchanged due
 * to Annex B aliases and live exports.
 *
 * @example
 * // ◀️ before
 * const TAX = 0.2;
 * function withTax(n) {
 *   return n + n * TAX;
 * }
 * total = withTax(100);
 *
 * // ▶️ after
 * const TAX = 0.2;
 * var withTax = function (n) {
 *   return n + n * TAX;
 * };
 * total = withTax(100);
 */
export function functionDeclarationToExpression(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  FunctionDeclaration(path, state) {
    const id = path.node.id
    if (!id || !isConvertible(path, id)) {
      return
    }
    const node = path.node
    const fn = t.functionExpression(null, node.params, node.body, node.generator, node.async)
    path.replaceWith(t.variableDeclaration('var', [t.variableDeclarator(t.cloneNode(id), fn)]))
    state.changed = true
  },
}

function isConvertible(path: NodePath<t.FunctionDeclaration>, id: t.Identifier): boolean {
  const parent = path.parentPath
  if (!parent) {
    return false
  }
  const atScriptTop = parent.isProgram() && parent.node.sourceType !== 'module'
  const inFunctionBody = parent.isBlockStatement() && parent.parentPath.isFunction()
  if (!atScriptTop && !inFunctionBody) {
    return false
  }

  const binding = path.scope.getBinding(id.name)
  if (!binding || binding.path.node !== path.node) {
    return false
  }
  if (binding.constantViolations.some(isRedeclaration)) {
    return false
  }

  const body = (parent.node as t.Program | t.BlockStatement).body
  const index = path.key as number
  for (let i = 0; i < index; i++) {
    if (!isInertStatement(body[i]!)) {
      return false
    }
  }
  return true
}

// Redeclarations make the hoisted value order-sensitive.
function isRedeclaration(path: NodePath): boolean {
  return path.isFunctionDeclaration() || path.isClassDeclaration() || path.isVariableDeclarator()
}

// An inert prologue cannot run user code or read a converted function binding.
function isInertStatement(stmt: t.Statement): boolean {
  if (t.isFunctionDeclaration(stmt) || t.isImportDeclaration(stmt) || t.isEmptyStatement(stmt)) {
    return true
  }
  if (t.isVariableDeclaration(stmt)) {
    return stmt.declarations.every((declarator) => isInertInit(declarator.init))
  }
  return false
}

function isInertInit(init: t.VariableDeclarator['init']): boolean {
  return (
    init == null ||
    t.isNumericLiteral(init) ||
    t.isStringLiteral(init) ||
    t.isBooleanLiteral(init) ||
    t.isNullLiteral(init) ||
    t.isBigIntLiteral(init) ||
    t.isRegExpLiteral(init) ||
    t.isThisExpression(init) ||
    t.isFunctionExpression(init) ||
    t.isArrowFunctionExpression(init)
  )
}
