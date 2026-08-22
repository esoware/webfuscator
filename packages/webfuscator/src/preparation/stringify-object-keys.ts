import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isProtoKey } from '../utils/ast'

/**
 * Rewrites property keys in object literals and classes as computed strings.
 * Already-computed keys, private names, and class constructors stay unchanged.
 * A method named `["constructor"]` is not a constructor and may be rewritten.
 *
 * The ECMA-262 B.3.1 `__proto__` setter form also stays unchanged.
 * `{ __proto__: x }` sets `[[Prototype]]`, while `{ ["__proto__"]: x }` creates
 * an own property.
 *
 * @example
 * // ◀️ before
 * const o = { foo: 1, bar() { return 2; }, [computed]: 3 };
 * class A { m() {} static s() {} }
 *
 * // ▶️ after
 * const o = { ["foo"]: 1, ["bar"]() { return 2; }, [computed]: 3 };
 * class A { ["m"]() {} static ["s"]() {} }
 */
export function stringifyObjectKeys(ast: File): void {
  traverse(ast, visitor)
}

const visitor = {
  ObjectProperty(path: NodePath<t.ObjectProperty>) {
    if (isProtoSetter(path.node) || keyOrderIsSpreadSensitive(path)) {
      return
    }
    if (stringifyKey(path.node)) {
      path.node.shorthand = false
    }
  },
  ObjectMethod(path: NodePath<t.ObjectMethod>) {
    if (keyOrderIsSpreadSensitive(path)) {
      return
    }
    stringifyKey(path.node)
  },
  ClassMethod(path: { node: t.ClassMethod }) {
    if (path.node.kind === 'constructor') {
      return
    }
    stringifyKey(path.node)
  },
}

// With a spread present, V8 moves non-computed accessors after data properties
// but leaves computed accessors in place. Rewriting would reorder own keys.
function keyOrderIsSpreadSensitive(path: NodePath<t.ObjectProperty | t.ObjectMethod>): boolean {
  const object = path.parentPath
  if (!object || !object.isObjectExpression()) {
    return false
  }
  const properties = object.node.properties
  const hasSpread = properties.some((prop) => t.isSpreadElement(prop))
  if (!hasSpread) {
    return false
  }
  return properties.some(
    (prop) =>
      t.isObjectMethod(prop) && (prop.kind === 'get' || prop.kind === 'set') && !prop.computed,
  )
}

function isProtoSetter(node: t.ObjectProperty): boolean {
  return !node.computed && !node.shorthand && isProtoKey(node.key)
}

function stringifyKey(node: t.ObjectProperty | t.ObjectMethod | t.ClassMethod): boolean {
  if (node.computed) {
    return false
  }
  if (t.isPrivateName(node.key)) {
    return false
  }
  const stringKey = keyToString(node.key)
  if (stringKey === null) {
    return false
  }
  // Babel 8 narrows keyed nodes by `computed`, so both fields need widening.
  const rewritten = node as t.ObjectProperty | t.ObjectMethod | t.ClassMethod
  rewritten.key = t.stringLiteral(stringKey)
  rewritten.computed = true
  return true
}

function keyToString(key: t.Node): string | null {
  if (t.isIdentifier(key)) {
    return key.name
  }
  if (t.isStringLiteral(key)) {
    return key.value
  }
  if (t.isNumericLiteral(key)) {
    return String(key.value)
  }
  if (t.isBigIntLiteral(key)) {
    return key.value.toString()
  }
  return null
}
