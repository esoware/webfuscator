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
  const { container, key: index } = path
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

// `with` can shadow names outside Babel's scope table.
export function isInsideWith(path: NodePath): boolean {
  if (!programContains(path.scope.getProgramParent().block, programWith, t.isWithStatement)) {
    return false
  }
  return path.findParent((ancestor) => ancestor.isWithStatement()) !== null
}

// Direct eval can access local bindings by name. Indirect eval runs globally and
// does not count.
export function enclosingScopeHasDirectEval(path: NodePath): boolean {
  if (!programContains(path.scope.getProgramParent().block, programDirectEval, isDirectEvalCall)) {
    return false
  }
  let current: NodePath | null = path
  while (current) {
    if ((current.isFunction() || current.isProgram()) && ownScopeHasDirectEval(current.node)) {
      return true
    }
    current = current.parentPath
  }
  return false
}

// Cache program-wide `eval` and `with` checks to avoid a subtree walk per name.
// No transform creates either construct, so a negative result stays valid.
const programDirectEval = new WeakMap<t.Node, boolean>()
const programWith = new WeakMap<t.Node, boolean>()

function programContains(
  programNode: t.Node,
  cache: WeakMap<t.Node, boolean>,
  matches: (node: t.Node) => boolean,
): boolean {
  const cached = cache.get(programNode)
  if (cached !== undefined) {
    return cached
  }
  let found = false
  t.traverseFast(programNode, (node) => {
    if (!matches(node)) {
      return
    }
    found = true
    return t.traverseFast.stop
  })
  cache.set(programNode, found)
  return found
}

function ownScopeHasDirectEval(owner: t.Node): boolean {
  let found = false
  // This walk stops at the first hit, unlike `walkOwnFunctionScope`.
  t.traverseFast(owner, (node) => {
    if (isDirectEvalCall(node)) {
      found = true
      return t.traverseFast.stop
    }
    return node !== owner && t.isFunction(node) ? t.traverseFast.skip : undefined
  })
  return found
}

export function isDirectEvalCall(node: t.Node): boolean {
  return t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === 'eval'
}
