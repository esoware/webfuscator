import traverse from '@babel/traverse'
import type { Binding, NodePath, Scope, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import type { ChangeState } from '../utils/change-tracking'
import { referencesOrWritesVariable } from '../utils/paths'

/**
 * Moves eligible function declarations to their only references as anonymous
 * function expressions.
 *
 * @example
 * // ◀️ before
 * function greet(name) {
 *   return 'hi ' + name;
 * }
 * button.addEventListener('click', greet);
 *
 * // ▶️ after
 * button.addEventListener('click', function (name) {
 *   return 'hi ' + name;
 * });
 */
export function collapseSingleUseFunctions(ast: File): boolean {
  const state: CollapseState = { candidates: [], changed: false }
  traverse(ast, collectVisitor, undefined, state)

  for (const path of state.candidates) {
    if (tryRelocateSingleUseFunction(path)) {
      state.changed = true
    }
  }
  return state.changed
}

interface CollapseState extends ChangeState {
  candidates: NodePath<t.FunctionDeclaration>[]
}

const collectVisitor: Visitor<CollapseState> = {
  Program(path) {
    // Earlier passes splice statement arrays without refreshing Babel's bindings.
    path.scope.crawl()
  },
  FunctionDeclaration: {
    exit(path, state) {
      // Inner declarations must move before an outer move detaches their paths.
      state.candidates.push(path)
    },
  },
}

function tryRelocateSingleUseFunction(path: NodePath<t.FunctionDeclaration>): boolean {
  if (!isPathLive(path)) {
    return false
  }
  const id = path.node.id
  if (!id) {
    return false
  }
  const parent = path.parentPath
  if (parent && (parent.isExportNamedDeclaration() || parent.isExportDefaultDeclaration())) {
    return false
  }

  const binding = path.scope.getBinding(id.name)
  if (!binding || binding.path.node !== path.node) {
    return false
  }
  if (binding.constantViolations.length > 0) {
    return false
  }
  if (binding.references !== 1) {
    return false
  }

  const refPath = binding.referencePaths[0]
  if (!refPath || !isPathLive(refPath)) {
    return false
  }
  if (!referenceRunsOncePerDeclarationActivation(refPath, binding.scope.block)) {
    return false
  }
  if (!referenceAcceptsExpression(refPath)) {
    return false
  }
  if (!freeBindingsResolveAtReference(path, refPath)) {
    return false
  }
  if (removingDeclarationCreatesDirective(path)) {
    return false
  }

  const source = t.cloneNode(path.node, true)
  const relocated = t.functionExpression(
    null,
    source.params,
    source.body,
    source.generator,
    source.async,
  )
  refPath.replaceWith(relocated)
  path.remove()
  return true
}

// Relocation under a loop, nested function, or class may create more than one
// function per declaration-scope activation.
function referenceRunsOncePerDeclarationActivation(
  refPath: NodePath,
  declarationScope: t.Node,
): boolean {
  for (let current: NodePath | null = refPath.parentPath; current; current = current.parentPath) {
    if (current.node === declarationScope) {
      return true
    }
    if (current.isFunction() || current.isLoop() || current.isClass()) {
      return false
    }
  }
  return false
}

// Moving the function also moves the lexical environment captured by every
// free read and write in its parameters, body, and nested closures.
function freeBindingsResolveAtReference(
  functionPath: NodePath<t.FunctionDeclaration>,
  refPath: NodePath,
): boolean {
  let bindingsMatch = true
  functionPath.traverse({
    Identifier(path) {
      const name = path.node.name
      // Ordinary functions keep their own `arguments`; arrows nested in them
      // keep capturing that same implicit binding after the move.
      if (name === 'arguments' || !referencesOrWritesVariable(path)) {
        return
      }
      const binding = path.scope.getBinding(name)
      if (binding && bindingBelongsToFunction(binding, functionPath.scope)) {
        return
      }
      if (refPath.scope.getBinding(name) !== binding) {
        bindingsMatch = false
        path.stop()
      }
    },
  })
  return bindingsMatch
}

function bindingBelongsToFunction(binding: Binding, functionScope: Scope): boolean {
  for (let scope: Scope | undefined = binding.scope; scope; scope = scope.parent) {
    if (scope === functionScope) {
      return true
    }
  }
  return false
}

// A declaration can be the only barrier keeping a later string out of a
// directive prologue.
function removingDeclarationCreatesDirective(path: NodePath<t.FunctionDeclaration>): boolean {
  let statementPath: NodePath = path
  while (
    statementPath.parentPath?.isLabeledStatement() &&
    statementPath.parentPath.node.body === statementPath.node
  ) {
    statementPath = statementPath.parentPath
  }

  const parent = statementPath.parentPath
  let body: readonly t.Node[]
  if (parent?.isProgram()) {
    body = parent.node.body
  } else if (parent?.isBlockStatement() && parent.parentPath?.isFunction()) {
    body = parent.node.body
  } else {
    return false
  }

  const index = body.indexOf(statementPath.node)
  if (index === -1 || !isStringExpressionStatement(body[index + 1])) {
    return false
  }
  return body.slice(0, index).every((node) => isStringExpressionStatement(node))
}

function isStringExpressionStatement(node: t.Node | undefined): boolean {
  return t.isExpressionStatement(node) && t.isStringLiteral(node.expression)
}

function referenceAcceptsExpression(refPath: NodePath): boolean {
  const parent = refPath.parentPath
  if (!parent) {
    return false
  }
  if (parent.isExportSpecifier() || parent.isExportDefaultDeclaration()) {
    return false
  }
  if (parent.isObjectProperty() && parent.node.shorthand) {
    return false
  }
  if (parent.isUnaryExpression() && parent.node.operator === 'delete') {
    return false
  }
  return true
}

// Babel does not mark descendant paths removed when it removes an ancestor.
function isPathLive(path: NodePath): boolean {
  for (let current: NodePath | null = path; current; current = current.parentPath) {
    if (current.removed || current.node == null) {
      return false
    }
    if (current.isProgram()) {
      return true
    }
  }
  return false
}
