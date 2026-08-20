import traverse from '@babel/traverse'
import type { NodePath, Scope, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { initializerReaches } from 'src/analysis/document-order'
import { enclosingScopeHasDirectEval, isInsideWith } from 'src/utils/ast'
import { hasConstantViolation } from 'src/utils/paths'

/**
 * Lifts safe lexical declarations to function-scoped `var`, renaming collisions
 * caused by hoisting. TDZ reads, reassigned constants, captured loop bindings,
 * uninitialized loop heads, program scope, `with`, and direct eval are refused.
 *
 * @example
 * // ◀️ before
 * function f() {
 *   const x = 1;
 *   return x;
 * }
 *
 * // ▶️ after
 * function f() {
 *   var x = 1;
 *   return x;
 * }
 */
export function constLetToVar(ast: File): boolean {
  const state = { changed: false }
  traverse(ast, {
    VariableDeclaration(path) {
      const { kind } = path.node
      if (kind !== 'let' && kind !== 'const') {
        return
      }
      // Babel cannot see names supplied by `with` or direct eval.
      if (isInsideWith(path) || enclosingScopeHasDirectEval(path)) {
        return
      }
      // A `var` write would lose the `const` TypeError.
      if (kind === 'const' && hasConstantViolation(path)) {
        return
      }
      // Hoisted `var` reads `undefined` where a lexical binding throws in TDZ.
      if (hasTdzRiskyReference(path)) {
        return
      }
      // An uninitialized lexical loop head resets on each entry. `var` does not.
      if (forHeadMissingInitializer(path)) {
        return
      }
      // Top-level `var` creates a global property. Lexical declarations do not.
      const blockScope = path.scope
      const varScope = blockScope.getFunctionParent() ?? blockScope.getProgramParent()
      if (varScope.path.isProgram()) {
        return
      }
      // One `var` cannot preserve per-iteration bindings captured by closures.
      if (capturedInEnclosingLoop(path)) {
        return
      }
      transformBlockScopedVariable(path, varScope)
      state.changed = true
    },

    ClassDeclaration(path) {
      const { id } = path.node
      if (!id) {
        return
      }
      if (isInsideWith(path) || enclosingScopeHasDirectEval(path)) {
        return
      }

      const { scope } = path.parentPath
      if (!isVarScope(scope) && scope.parent!.hasBinding(id.name, { noUids: true })) {
        path.scope.rename(id.name)
        state.changed = true
      }
    },
  })
  return state.changed
}

const conflictingFunctionsVisitor: Visitor<{ names: string[] }> = {
  Scope(path, { names }) {
    for (const name of names) {
      const binding = path.scope.getOwnBinding(name)
      if (binding?.kind === 'hoisted') {
        path.scope.rename(name)
      }
    }
  },
  Expression(path) {
    path.skip()
  },
  Declaration(path) {
    path.skip()
  },
}

// Same-scope uses need a reachable initializer. Nested uses also need their
// function value created after initialization.
function hasTdzRiskyReference(path: NodePath<t.VariableDeclaration>): boolean {
  const declHome = nearestFunctionOrProgram(path)
  for (const name of Object.keys(path.getBindingIdentifiers())) {
    const binding = path.scope.getBinding(name)
    if (!binding) {
      continue
    }
    for (const usage of [...binding.referencePaths, ...binding.constantViolations]) {
      if (usage.findParent((ancestor) => ancestor === path)) {
        return true
      }
      const usageHome = nearestFunctionOrProgram(usage)
      if (usageHome === declHome) {
        if (!initializerReaches(path, usage)) {
          return true
        }
        continue
      }
      const nested = outermostNestedFunction(usage, declHome)
      if (!nested || nested.isFunctionDeclaration() || !initializerReaches(path, nested)) {
        return true
      }
    }
  }
  return false
}

function forHeadMissingInitializer(path: NodePath<t.VariableDeclaration>): boolean {
  if (!t.isForStatement(path.parent) || path.key !== 'init') {
    return false
  }
  return path.node.declarations.some((decl) => decl.init == null)
}

// A nested function or class can observe the loop's per-iteration binding.
function capturedInEnclosingLoop(path: NodePath<t.VariableDeclaration>): boolean {
  const loop = enclosingLoop(path)
  if (!loop) {
    return false
  }
  for (const name of Object.keys(path.getBindingIdentifiers())) {
    const binding = path.scope.getBinding(name)
    if (!binding) {
      continue
    }
    for (const usage of [...binding.referencePaths, ...binding.constantViolations]) {
      for (
        let current = usage.parentPath;
        current && current !== loop;
        current = current.parentPath
      ) {
        if (current.isFunction() || current.isClass()) {
          return true
        }
      }
    }
  }
  return false
}

function transformBlockScopedVariable(
  path: NodePath<t.VariableDeclaration>,
  varScope: Scope,
): void {
  path.node.kind = 'var'

  const bindingNames = Object.keys(path.getBindingIdentifiers())
  for (const name of bindingNames) {
    const binding = path.scope.getOwnBinding(name)
    if (!binding) {
      continue
    }
    binding.kind = 'var'
  }

  if (enclosingLoop(path) && !isVarInLoopHead(path)) {
    for (const decl of path.node.declarations) {
      // Without an initializer, `var` retains the prior iteration's value.
      decl.init ??= t.buildUndefinedNode()
    }
  }

  const blockScope = path.scope
  if (varScope !== blockScope) {
    for (const name of bindingNames) {
      let newName = name
      if (
        blockScope.parent!.hasBinding(name, { noUids: true }) ||
        blockScope.parent!.hasGlobal(name)
      ) {
        newName = blockScope.generateUid(name)
        blockScope.rename(name, newName)
      }

      blockScope.moveBindingTo(newName, varScope)
    }
  }

  blockScope.path.traverse(conflictingFunctionsVisitor, {
    names: bindingNames,
  })
}

function nearestFunctionOrProgram(path: NodePath): NodePath {
  return path.findParent((ancestor) => ancestor.isFunction() || ancestor.isProgram())!
}

// The shallowest nested function decides when this use can run.
function outermostNestedFunction(usage: NodePath, home: NodePath): NodePath | null {
  let result: NodePath | null = null
  for (let current = usage.parentPath; current && current !== home; current = current.parentPath) {
    if (current.isFunction()) {
      result = current
    }
  }
  return result
}

function enclosingLoop(path: NodePath): NodePath<t.Loop> | null {
  for (let current = path.parentPath; current; current = current.parentPath) {
    if (current.isFunction()) {
      return null
    }
    if (current.isLoop()) {
      return current
    }
  }
  return null
}

function isVarScope(scope: Scope): boolean {
  return scope.path.isFunctionParent() || scope.path.isProgram()
}

function isVarInLoopHead(path: NodePath<t.VariableDeclaration>): boolean {
  if (t.isForStatement(path.parent)) {
    return path.key === 'init'
  }
  if (t.isForXStatement(path.parent)) {
    return path.key === 'left'
  }
  return false
}
