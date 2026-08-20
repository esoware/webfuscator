import type { Binding, NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { initializerReaches } from 'src/analysis/document-order'
import { isInsideWith, isProtoKey } from 'src/utils/ast'
import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'
import { isCalleeOrTagOf } from 'src/utils/paths'

/**
 * Replaces a constant object or array wrapper with one binding per entry when
 * every reference is a static-key read. The inliner can then see function
 * values directly.
 *
 * @example
 * // ◀️ before
 * var ops = {
 *   double: function (x) { return x * 2; },
 *   negate: function (x) { return -x; },
 * };
 * log(ops.double(3), ops.negate(7));
 *
 * // ▶️ after
 * var double = function (x) { return x * 2; };
 * var negate = function (x) { return -x; };
 * log(double(3), negate(7));
 */
export function extractObjectProperties(ast: File): boolean {
  return traverseForChanges(ast, extractVisitor)
}

const extractVisitor: Visitor<ChangeState> = {
  VariableDeclaration: {
    exit(path, state) {
      if (tryExtractDeclaration(path)) {
        state.changed = true
      }
    },
  },
}

function tryExtractDeclaration(path: NodePath<t.VariableDeclaration>): boolean {
  if (path.node.declarations.length !== 1) {
    return false
  }
  // Babel hides lexical replacements for a `for` initializer inside an IIFE.
  if (path.key === 'init' && path.parentPath?.isForStatement() && path.node.kind !== 'var') {
    return false
  }
  const [declaratorPath] = path.get('declarations')
  if (!declaratorPath) {
    return false
  }

  const idPath = declaratorPath.get('id')
  if (!idPath.isIdentifier()) {
    return false
  }
  const idName = idPath.node.name

  const initPath = declaratorPath.get('init')
  if (!initPath.node) {
    return false
  }

  if (initPath.isObjectExpression()) {
    const entries = collectObjectEntries(initPath)
    if (entries === null) {
      return false
    }
    return performExtraction(path, idName, initPath, entries, false)
  }
  if (initPath.isArrayExpression()) {
    const entries = collectArrayEntries(initPath)
    if (entries === null) {
      return false
    }
    return performExtraction(path, idName, initPath, entries, true)
  }
  return false
}

interface Entry {
  key: string
  value: t.Expression
  // Bare calls are safe only for arrows or functions that never read `this`.
  callSafe: boolean
}

function collectObjectEntries(initPath: NodePath<t.ObjectExpression>): Entry[] | null {
  const entries: Entry[] = []
  const seen = new Set<string>()
  for (const propPath of initPath.get('properties')) {
    if (!propPath.isObjectProperty()) {
      // Object methods receive the literal as `this`.
      return null
    }
    // The `__proto__` setter form creates no own property to extract.
    if (isProtoSetter(propPath.node)) {
      return null
    }
    const key = staticPropertyKey(propPath.node)
    if (key === null) {
      return null
    }
    if (seen.has(key)) {
      return null
    }
    seen.add(key)

    const valuePath = propPath.get('value')
    if (Array.isArray(valuePath)) {
      return null
    }
    if (!valuePath.isExpression()) {
      return null
    }
    if (functionRefsThis(valuePath)) {
      return null
    }

    entries.push({ key, value: valuePath.node, callSafe: isCallSafeValue(valuePath.node) })
  }
  return entries
}

function isProtoSetter(node: t.ObjectProperty): boolean {
  return !node.computed && !node.shorthand && isProtoKey(node.key)
}

function isCallSafeValue(node: t.Expression): boolean {
  // Surviving function values are receiver-independent.
  return t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)
}

function collectArrayEntries(initPath: NodePath<t.ArrayExpression>): Entry[] | null {
  const entries: Entry[] = []
  const elementPaths = initPath.get('elements')
  for (let i = 0; i < elementPaths.length; i++) {
    const elementPath = elementPaths[i]!
    // An array hole has no value node to bind.
    if (!elementPath.node) {
      return null
    }
    if (elementPath.isSpreadElement()) {
      return null
    }
    if (!elementPath.isExpression()) {
      return null
    }
    if (functionRefsThis(elementPath)) {
      return null
    }
    entries.push({
      key: String(i),
      value: elementPath.node,
      callSafe: isCallSafeValue(elementPath.node),
    })
  }
  return entries
}

function performExtraction(
  path: NodePath<t.VariableDeclaration>,
  idName: string,
  initPath: NodePath<t.ObjectExpression | t.ArrayExpression>,
  entries: Entry[],
  isArray: boolean,
): boolean {
  const binding = path.scope.getBinding(idName)
  if (!binding) {
    return false
  }
  if (!binding.constant) {
    return false
  }

  // `with` can shadow a synthesized entry binding.
  if (isInsideWith(path)) {
    return false
  }

  if (initContainsSelfReference(binding, initPath)) {
    return false
  }

  const callSafeByKey = new Map(entries.map((entry) => [entry.key, entry.callSafe]))
  const validKeys = new Set(entries.map((entry) => entry.key))

  interface Replacement {
    memberPath: NodePath<t.MemberExpression>
    key: string
  }
  const replacements: Replacement[] = []
  const seenMembers = new Set<t.MemberExpression>()

  for (const ref of binding.referencePaths) {
    // Before initialization, a wrapper read throws while a bare binding may not.
    if (!initializerReaches(path, ref)) {
      return false
    }
    // `with` can redirect the rewritten reference.
    if (isInsideWith(ref)) {
      return false
    }

    const parent = ref.parentPath
    if (!parent || !parent.isMemberExpression()) {
      return false
    }
    if (parent.node.object !== ref.node) {
      return false
    }

    const key = staticMemberKey(parent.node)
    if (key === null) {
      return false
    }
    if (!validKeys.has(key)) {
      return false
    }

    if (isWriteTargetMember(parent)) {
      return false
    }
    // Extracting a method call drops its receiver.
    if (isCalleeOrTagOf(parent) && !callSafeByKey.get(key)) {
      return false
    }

    // Earlier extraction can publish the same member twice. Replace each node
    // once to avoid a detached-path error.
    if (seenMembers.has(parent.node)) {
      continue
    }
    seenMembers.add(parent.node)

    replacements.push({ memberPath: parent, key })
  }

  const { scope } = path
  const usedNames = new Set<string>()
  const keyToName = new Map<string, string>()
  for (const { key } of entries) {
    const baseName = isArray ? `${idName}${key}` : key
    const baseNameIsFree =
      t.isValidIdentifier(baseName) &&
      !usedNames.has(baseName) &&
      !scope.hasBinding(baseName) &&
      !scope.hasGlobal(baseName) &&
      !scope.hasReference(baseName)
    const chosen = baseNameIsFree
      ? baseName
      : scope.generateUid(t.isValidIdentifier(baseName) ? baseName : 'property')
    usedNames.add(chosen)
    keyToName.set(key, chosen)
  }

  const newDecls = entries.map(({ key, value }) =>
    t.variableDeclaration(path.node.kind, [
      t.variableDeclarator(t.identifier(keyToName.get(key)!), value),
    ]),
  )

  const newPaths = path.replaceWithMultiple(newDecls)
  for (const newPath of newPaths) {
    newPath.scope.registerDeclaration(newPath)
  }

  // Publish rewritten references for the next fixed-point iteration.
  for (const { memberPath, key } of replacements) {
    const name = keyToName.get(key)!
    const [newRefPath] = memberPath.replaceWith(t.identifier(name))
    if (newRefPath) {
      const refBinding = newRefPath.scope.getBinding(name)
      if (refBinding) {
        refBinding.referencePaths.push(newRefPath)
        refBinding.references++
      }
    }
  }

  // Remove the dead wrapper binding before the same name is visited again.
  path.scope.removeBinding(idName)

  return true
}

function staticPropertyKey(prop: t.ObjectProperty): string | null {
  const { key } = prop
  if (!prop.computed && t.isIdentifier(key)) {
    return key.name
  }
  return literalKeyToString(key)
}

function staticMemberKey(node: t.MemberExpression): string | null {
  if (!node.computed) {
    if (t.isIdentifier(node.property)) {
      return node.property.name
    }
    return null
  }
  return literalKeyToString(node.property)
}

function literalKeyToString(node: t.Node): string | null {
  if (t.isStringLiteral(node)) {
    return node.value
  }
  if (t.isNumericLiteral(node)) {
    return String(node.value)
  }
  if (t.isBigIntLiteral(node)) {
    return node.value.toString()
  }
  return null
}

// A member nested inside a destructuring target is still a write.
function isWriteTargetMember(memberPath: NodePath<t.MemberExpression>): boolean {
  let current: NodePath = memberPath
  let parent: NodePath | null = current.parentPath
  while (parent) {
    if (parent.isAssignmentExpression() && parent.node.left === current.node) {
      return true
    }
    if (parent.isUpdateExpression() && parent.node.argument === current.node) {
      return true
    }
    if (
      parent.isUnaryExpression() &&
      parent.node.operator === 'delete' &&
      parent.node.argument === current.node
    ) {
      return true
    }
    if (
      (parent.isForInStatement() || parent.isForOfStatement()) &&
      parent.node.left === current.node
    ) {
      return true
    }
    if (
      parent.isArrayPattern() ||
      parent.isObjectPattern() ||
      parent.isObjectProperty() ||
      parent.isRestElement() ||
      (parent.isAssignmentPattern() && parent.node.left === current.node)
    ) {
      current = parent
      parent = current.parentPath
      continue
    }
    break
  }
  return false
}

function functionRefsThis(path: NodePath): boolean {
  const { node } = path
  if (!t.isFunctionExpression(node) && !t.isFunctionDeclaration(node)) {
    return false
  }
  const state: { found: boolean } = { found: false }
  path.traverse(functionRefsThisVisitor, state)
  return state.found
}

const functionRefsThisVisitor: Visitor<{ found: boolean }> = {
  ThisExpression(_path, state) {
    state.found = true
  },
  Function(path, state) {
    if (path.isArrowFunctionExpression()) {
      return
    }
    // Computed method keys use the enclosing `this`. The key node itself needs a
    // separate check because traversal starts below it.
    if ((path.isObjectMethod() || path.isClassMethod()) && path.node.computed) {
      const keyPath = path.get('key') as NodePath
      if (keyPath.isThisExpression()) {
        state.found = true
      } else {
        keyPath.traverse(functionRefsThisVisitor, state)
      }
    }
    path.skip()
  },
}

function initContainsSelfReference(binding: Binding, initPath: NodePath): boolean {
  for (const ref of binding.referencePaths) {
    let ancestor: NodePath | null = ref
    while (ancestor) {
      if (ancestor === initPath) {
        return true
      }
      ancestor = ancestor.parentPath
    }
  }
  return false
}
