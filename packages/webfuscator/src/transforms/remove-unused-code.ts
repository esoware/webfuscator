import traverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isSideEffectFree } from '../analysis/purity'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Removes unused declarations and side-effect-free expression statements until
 * no further code becomes unused.
 *
 * @example
 * // ◀️ before
 * function foo() { return "foo"; }
 * function bar() { return "bar"; }
 * var unused = 1;
 * foo();
 *
 * // ▶️ after
 * function foo() { return "foo"; }
 * foo();
 */
export function removeUnusedCode(ast: File): boolean {
  // Earlier relocation can leave references on detached paths. Rebuild once,
  // then maintain counts during removal.
  crawlProgramScope(ast)
  let anyChanged = false
  const state: ChangeState = { changed: true }
  while (state.changed) {
    state.changed = false
    traverse(ast, sweepVisitor, undefined, state)
    if (state.changed) {
      anyChanged = true
    }
  }
  return anyChanged
}

function crawlProgramScope(ast: File): void {
  traverse(ast, {
    Program(path) {
      path.scope.crawl()
      path.stop()
    },
  })
}

const sweepVisitor: Visitor<ChangeState> = {
  VariableDeclarator(path, state) {
    if (tryRemoveDeclarator(path)) {
      state.changed = true
    }
  },
  FunctionDeclaration(path, state) {
    if (tryRemoveFunctionDecl(path)) {
      state.changed = true
    }
  },
  ClassDeclaration(path, state) {
    if (tryRemoveClassDecl(path)) {
      state.changed = true
    }
  },
  ExpressionStatement(path, state) {
    if (tryRemoveExpressionStatement(path)) {
      state.changed = true
    }
  },
}

const dereferenceVisitor: Visitor = {
  Identifier(path) {
    if (!path.isReferencedIdentifier()) {
      return
    }
    const binding = path.scope.getBinding(path.node.name)
    if (binding) {
      binding.dereference()
    }
  },
}

function dereferenceSubtree(rootPath: NodePath): void {
  if (rootPath.isReferencedIdentifier()) {
    const binding = rootPath.scope.getBinding((rootPath.node as t.Identifier).name)
    if (binding) {
      binding.dereference()
    }
  }
  rootPath.traverse(dereferenceVisitor)
}

function tryRemoveDeclarator(path: NodePath<t.VariableDeclarator>): boolean {
  const declaration = path.parentPath
  if (!declaration || !declaration.isVariableDeclaration()) {
    return false
  }

  const grandparent = declaration.parentPath
  if (!grandparent) {
    return false
  }
  if (grandparent.isExportNamedDeclaration() || grandparent.isExportDefaultDeclaration()) {
    return false
  }
  if (
    grandparent.isForStatement() ||
    grandparent.isForInStatement() ||
    grandparent.isForOfStatement()
  ) {
    return false
  }

  const id = path.node.id
  if (!t.isIdentifier(id)) {
    return false
  }

  const init = path.node.init
  if (init && !isSideEffectFree(init, path.scope)) {
    return false
  }

  const binding = path.scope.getBinding(id.name)
  if (!binding) {
    return false
  }
  if (binding.references > 0) {
    return false
  }
  if (declaration.node.kind !== 'const' && binding.constantViolations.length > 0) {
    return false
  }
  if (path.node.init) {
    dereferenceSubtree(path.get('init') as NodePath)
  }
  path.scope.removeBinding(id.name)
  path.remove()
  if (declaration.node && declaration.node.declarations.length === 0) {
    declaration.remove()
  }
  return true
}

function tryRemoveFunctionDecl(path: NodePath<t.FunctionDeclaration>): boolean {
  if (isExported(path)) {
    return false
  }
  const id = path.node.id
  if (!id) {
    return false
  }

  const binding = path.scope.getBinding(id.name)
  if (!binding) {
    return false
  }
  if (binding.references > 0) {
    return false
  }
  if (binding.constantViolations.length > 0) {
    return false
  }
  dereferenceSubtree(path.get('body') as NodePath)
  path.scope.removeBinding(id.name)
  path.remove()
  return true
}

function tryRemoveClassDecl(path: NodePath<t.ClassDeclaration>): boolean {
  if (isExported(path)) {
    return false
  }
  const id = path.node.id
  if (!id) {
    return false
  }

  // `extends`, computed keys, static fields, and static blocks run on evaluation.
  if (path.node.superClass && !isSideEffectFree(path.node.superClass, path.scope)) {
    return false
  }
  for (const member of path.node.body.body) {
    // Public and private static fields have different Babel node types.
    if ((t.isClassProperty(member) || t.isClassPrivateProperty(member)) && member.static) {
      return false
    }
    if (t.isStaticBlock(member)) {
      return false
    }
    if (
      'computed' in member &&
      member.computed &&
      'key' in member &&
      !isSideEffectFree(member.key, path.scope)
    ) {
      return false
    }
  }

  const binding = path.scope.getBinding(id.name)
  if (!binding) {
    return false
  }
  if (binding.references > 0) {
    return false
  }
  if (binding.constantViolations.length > 0) {
    return false
  }
  dereferenceSubtree(path.get('body') as NodePath)
  if (path.node.superClass) {
    dereferenceSubtree(path.get('superClass') as NodePath)
  }
  path.scope.removeBinding(id.name)
  path.remove()
  return true
}

function tryRemoveExpressionStatement(path: NodePath<t.ExpressionStatement>): boolean {
  if (!isSideEffectFree(path.node.expression, path.scope)) {
    return false
  }
  dereferenceSubtree(path.get('expression') as NodePath)
  path.remove()
  return true
}

function isExported(path: NodePath): boolean {
  const parent = path.parentPath
  if (!parent) {
    return false
  }
  return parent.isExportNamedDeclaration() || parent.isExportDefaultDeclaration()
}
