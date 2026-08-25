import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

// A new string statement in a directive prologue can switch code to strict mode.
export function isInDirectivePrologue(path: NodePath): boolean {
  const parent = path.parentPath
  if (!parent) {
    return false
  }
  const inBody =
    parent.isProgram() ||
    (parent.isBlockStatement() && parent.parentPath != null && parent.parentPath.isFunction())
  if (!inBody) {
    return false
  }
  const container = path.container
  const index = path.key
  if (!Array.isArray(container) || typeof index !== 'number') {
    return false
  }
  for (let i = 0; i < index; i++) {
    const sibling = container[i] as t.Node
    if (!t.isExpressionStatement(sibling) || !t.isStringLiteral(sibling.expression)) {
      return false
    }
  }
  return true
}

// This read-only walk stops at nested functions. Mutation breaks its early exit.
export function walkOwnFunctionScope(root: t.Node, callback: (node: t.Node) => void): void {
  t.traverseFast(root, (node) => {
    const skipNested = node !== root && t.isFunction(node)
    if (!skipNested) {
      callback(node)
    }
    return skipNested ? t.traverseFast.skip : undefined
  })
}

// Duplicate parameters can change mapped `arguments` and default semantics.
// Names inside destructuring patterns count too.
export function hasDuplicateParamNames(params: t.Function['params']): boolean {
  const seen = new Set<string>()
  for (const param of params) {
    for (const name of Object.keys(t.getBindingIdentifiers(param))) {
      if (seen.has(name)) {
        return true
      }
      seen.add(name)
    }
  }
  return false
}

// Callers decide which computed or shorthand forms receive ECMA-262 B.3.1
// `__proto__` behavior.
export function isProtoKey(key: t.Node): boolean {
  return (
    (t.isIdentifier(key) && key.name === '__proto__') ||
    (t.isStringLiteral(key) && key.value === '__proto__')
  )
}

// A non-computed key names a property; it is not a runtime value.
export function isNonComputedKey(path: NodePath): boolean {
  const parent = path.parent
  return (
    'key' in parent && parent.key === path.node && 'computed' in parent && parent.computed === false
  )
}
