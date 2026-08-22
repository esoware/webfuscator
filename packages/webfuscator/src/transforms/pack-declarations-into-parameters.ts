import type { Binding, NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { enclosingScopeHasDirectEval, hasDuplicateParamNames } from '../utils/ast'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { isLiteralShaped } from '../utils/literal'
import { hasAnnexBFunctionAlias } from '../utils/paths'

/**
 * Moves leading literal-valued `var` declarations into trailing default
 * parameters. Arrows, rest parameters, name collisions, and functions with
 * callers that could fill a new slot stay unchanged.
 *
 * Packing also requires unchanged `arguments`, directive, and hoisting behavior.
 *
 * @example
 * // ◀️ before
 * function run() {
 *   var x = 1;
 *   return x;
 * }
 *
 * // ▶️ after
 * function run(x = 1) {
 *   return x;
 * }
 */
export function packDeclarationsIntoParameters(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  Function(path, state) {
    if (packLeadingIntoParams(path)) {
      state.changed = true
    }
  },
}

function packLeadingIntoParams(path: NodePath<t.Function>): boolean {
  // Accessors have fixed arity. Method calls are not analyzable, and arrows do
  // not own `arguments`.
  if (
    path.isArrowFunctionExpression() ||
    path.isObjectMethod() ||
    path.isClassMethod() ||
    path.isClassPrivateMethod()
  ) {
    return false
  }
  // An Annex B alias splits call sites across bindings Babel does not connect.
  if (hasAnnexBFunctionAlias(path)) {
    return false
  }
  const params = path.node.params
  if (params.some((param) => t.isRestElement(param))) {
    return false
  }
  // Adding a default makes duplicate sloppy parameters a syntax error.
  if (hasDuplicateParamNames(params)) {
    return false
  }

  const body = path.node.body
  if (!t.isBlockStatement(body)) {
    return false
  }
  // A strict directive forbids a non-simple parameter list.
  if (body.directives.length > 0) {
    return false
  }
  // Defaults make `arguments` unmapped.
  if (referencesArguments(path)) {
    return false
  }
  // Direct eval can inspect the newly unmapped `arguments` by name.
  if (enclosingScopeHasDirectEval(path)) {
    return false
  }
  // A caller with extra arguments could fill the new parameter slot.
  if (!allCallSitesRespectArity(path, params.length)) {
    return false
  }

  const existingNames = collectParamNames(params)
  // FunctionDeclarationInstantiation can replace a packed default with a hoisted
  // same-named function.
  const bodyFunctionNames = functionDeclarationNames(body)

  let packed = false
  while (body.body.length > 0) {
    const stmt = body.body[0]!
    if (!t.isVariableDeclaration(stmt) || stmt.kind !== 'var') {
      break
    }
    if (stmt.declarations.length !== 1) {
      break
    }
    const decl = stmt.declarations[0]!
    if (!t.isIdentifier(decl.id)) {
      break
    }
    if (!decl.init) {
      break
    }
    if (!isLiteralShaped(decl.init)) {
      break
    }
    if (existingNames.has(decl.id.name) || bodyFunctionNames.has(decl.id.name)) {
      break
    }

    params.push(t.assignmentPattern(t.cloneNode(decl.id), decl.init))
    existingNames.add(decl.id.name)
    body.body.shift()
    packed = true
  }
  return packed
}

function referencesArguments(path: NodePath<t.Function>): boolean {
  let found = false
  const argumentsVisitor: Visitor = {
    Function(inner) {
      if (inner.isArrowFunctionExpression()) {
        // Arrows read the enclosing `arguments`.
        return
      }
      // Non-arrow bodies bind `arguments`, but computed method keys use the
      // enclosing scope.
      const key = methodComputedKey(inner)
      if (key) {
        if (key.isIdentifier() && key.node.name === 'arguments') {
          found = true
        }
        key.traverse(argumentsVisitor)
      }
      inner.skip()
    },
    Identifier(inner) {
      if (inner.node.name === 'arguments' && inner.isReferencedIdentifier()) {
        found = true
      }
    },
  }
  path.traverse(argumentsVisitor)
  return found
}

function methodComputedKey(path: NodePath<t.Function>): NodePath | null {
  if (
    (path.isObjectMethod() || path.isClassMethod() || path.isClassPrivateMethod()) &&
    path.node.computed
  ) {
    return path.get('key') as NodePath
  }
  return null
}

// Every outer and recursive reference must be a direct call within the original
// arity and without spread.
function allCallSitesRespectArity(path: NodePath<t.Function>, arity: number): boolean {
  const external = functionBinding(path)
  if (!external || !external.constant || !bindingCallsRespectArity(external, arity)) {
    return false
  }
  if (path.isFunctionExpression() && path.node.id) {
    const inner = path.scope.getBinding(path.node.id.name)
    if (inner && (!inner.constant || !bindingCallsRespectArity(inner, arity))) {
      return false
    }
  }
  return true
}

function bindingCallsRespectArity(binding: Binding, arity: number): boolean {
  for (const ref of binding.referencePaths) {
    const parent = ref.parentPath
    if (
      !parent ||
      !(parent.isCallExpression() || parent.isOptionalCallExpression()) ||
      parent.node.callee !== ref.node
    ) {
      return false
    }
    const args = parent.node.arguments
    if (args.length > arity || args.some((arg) => t.isSpreadElement(arg))) {
      return false
    }
  }
  return true
}

// Annex B can hoist function names from nested blocks into this function scope.
function functionDeclarationNames(body: t.BlockStatement): Set<string> {
  const names = new Set<string>()
  t.traverseFast(body, (node) => {
    if (t.isFunctionDeclaration(node) && node.id) {
      names.add(node.id.name)
      return t.traverseFast.skip
    }
    return node !== body && t.isFunction(node) ? t.traverseFast.skip : undefined
  })
  return names
}

function functionBinding(path: NodePath<t.Function>): Binding | null {
  if (path.isFunctionDeclaration() && path.node.id) {
    return path.scope.parent?.getBinding(path.node.id.name) ?? null
  }
  const parent = path.parentPath
  if (
    parent?.isVariableDeclarator() &&
    parent.node.init === path.node &&
    t.isIdentifier(parent.node.id)
  ) {
    return parent.scope.getBinding(parent.node.id.name) ?? null
  }
  return null
}

// Parameter names inside patterns and defaults also block duplicate packing.
function collectParamNames(params: t.Function['params']): Set<string> {
  const names = new Set<string>()
  for (const param of params) {
    for (const name of Object.keys(t.getBindingIdentifiers(param))) {
      names.add(name)
    }
  }
  return names
}
