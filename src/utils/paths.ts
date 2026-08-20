import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

// Only statement-list positions accept several replacements. Loop heads do not.
export function isStandaloneDeclaration(declPath: NodePath<t.VariableDeclaration>): boolean {
  const owner = declPath.parentPath
  if (!owner) {
    return false
  }
  if (owner.isForStatement() && owner.node.init === declPath.node) {
    return false
  }
  if (owner.isForInStatement() && owner.node.left === declPath.node) {
    return false
  }
  if (owner.isForOfStatement() && owner.node.left === declPath.node) {
    return false
  }
  return owner.isBlock() || owner.isSwitchCase()
}

// Babel treats destructured writes as binding identifiers. Labels must still be
// excluded because they bind no variable.
export function referencesOrWritesVariable(path: NodePath<t.Identifier>): boolean {
  if (path.parentPath?.isLabeledStatement()) {
    return false
  }
  // Separate calls avoid an incorrect `never` narrowing across `||`.
  const isRead = path.isReferencedIdentifier()
  const isWrite = path.isBindingIdentifier()
  return isRead || isWrite
}

// Replacing a callee or tag member with a bare value would lose its `this`.
export function isCalleeOrTagOf(path: NodePath): boolean {
  const parent = path.parentPath
  if (!parent) {
    return false
  }
  if (
    (parent.isCallExpression() || parent.isOptionalCallExpression()) &&
    parent.node.callee === path.node
  ) {
    return true
  }
  return parent.isTaggedTemplateExpression() && parent.node.tag === path.node
}

// Strictness comes from modules, classes, or an enclosing directive prologue.
export function isInStrictContext(path: NodePath): boolean {
  for (let current: NodePath | null = path; current; current = current.parentPath) {
    if (current.isClass()) {
      return true
    }
    if (current.isProgram()) {
      return current.node.sourceType === 'module' || hasUseStrictDirective(current.node.directives)
    }
    if (
      current.isFunction() &&
      t.isBlockStatement(current.node.body) &&
      hasUseStrictDirective(current.node.body.directives)
    ) {
      return true
    }
  }
  return false
}

function hasUseStrictDirective(directives: readonly t.Directive[]): boolean {
  return directives.some((directive) => directive.value.value === 'use strict')
}

// ECMA-262 B.3.3 gives sloppy block-level functions a `var` alias that Babel
// omits from the enclosing scope. Renaming, moving, or removing one can expose it.
export function hasAnnexBFunctionAlias(path: NodePath): boolean {
  if (!path.isFunctionDeclaration()) {
    return false
  }
  const parent = path.parentPath
  if (!parent || parent.isProgram()) {
    return false
  }
  if (
    parent.isBlockStatement() &&
    parent.key === 'body' &&
    parent.parentPath != null &&
    parent.parentPath.isFunction()
  ) {
    return false
  }
  return !isInStrictContext(parent)
}

// A later write to `const` must keep throwing after transformation.
export function hasConstantViolation(path: NodePath<t.VariableDeclaration>): boolean {
  for (const name of Object.keys(path.getBindingIdentifiers())) {
    const binding = path.scope.getBinding(name)
    if (binding && binding.constantViolations.length > 0) {
      return true
    }
  }
  return false
}
