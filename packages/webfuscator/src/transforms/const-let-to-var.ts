import traverse from '@babel/traverse'
import type { NodePath, Scope, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

/**
 * Converts eligible `let` and `const` declarations to `var`, renaming bindings
 * when needed to avoid hoisting conflicts. Loop bindings stay unchanged when
 * conversion would alter iteration behavior.
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
      const kind = path.node.kind
      if (kind !== 'let' && kind !== 'const') {
        return
      }
      // An uninitialized lexical loop head resets on each entry. `var` does not.
      if (forHeadMissingInitializer(path)) {
        return
      }
      const blockScope = path.scope
      const varScope = blockScope.getFunctionParent() ?? blockScope.getProgramParent()
      // One `var` cannot preserve per-iteration bindings captured by closures.
      if (capturedInEnclosingLoop(path)) {
        return
      }
      transformBlockScopedVariable(path, varScope)
      state.changed = true
    },

    ClassDeclaration(path) {
      const id = path.node.id
      if (!id) {
        return
      }
      const scope = path.parentPath.scope
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
    const usages =
      binding.kind === 'const'
        ? binding.referencePaths
        : [...binding.referencePaths, ...binding.constantViolations]
    for (const usage of usages) {
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
