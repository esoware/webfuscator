import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isInsideWith, isProtoKey } from 'src/utils/ast'
import { isPrimitiveLiteral } from 'src/utils/literal'

/**
 * Moves safe instance fields into the constructor and safe static fields into
 * static blocks. The whole class stays intact unless every field can be lowered.
 *
 * `Object.defineProperty` preserves CreateDataProperty semantics. A plain
 * assignment could invoke an inherited setter or fail on an inherited read-only
 * property. Static blocks also preserve the class binding and `this`.
 *
 * Accessor collisions, special keys, inferred names, constructor parameter
 * scope, and relocated `this`, `super`, or `new.target` can all expose a rewrite.
 * Private or computed fields, derived classes, `with`, and a shadowed `Object`
 * are therefore refused.
 *
 * @example
 * // ◀️ before
 * class A {
 *   x = 1;
 *   static z = 2;
 * }
 *
 * // ▶️ after
 * class A {
 *   constructor() {
 *     Object.defineProperty(this, "x", {
 *       value: 1,
 *       writable: true,
 *       enumerable: true,
 *       configurable: true
 *     });
 *   }
 *   static {
 *     Object.defineProperty(this, "z", {
 *       value: 2,
 *       writable: true,
 *       enumerable: true,
 *       configurable: true
 *     });
 *   }
 * }
 */
export function rewriteClassFields(ast: File): void {
  traverse(ast, visitor)
}

const FORBIDDEN_STATIC_KEYS = new Set([
  'length',
  'name',
  'prototype',
  '__proto__',
  'caller',
  'arguments',
])

const visitor = {
  Class(path: NodePath<t.Class>) {
    const memberPaths = path.get('body.body')
    const instanceFields: t.ClassProperty[] = []
    const staticFields: t.ClassProperty[] = []
    let hasPrivateField = false
    let hasComputedAccessor = false
    const instanceAccessorKeys = new Set<string>()
    const staticAccessorKeys = new Set<string>()
    let ctorPath: NodePath<t.ClassMethod> | null = null

    for (const memberPath of memberPaths) {
      const member = memberPath.node
      if (t.isClassProperty(member)) {
        ;(member.static ? staticFields : instanceFields).push(member)
      } else if (t.isClassPrivateProperty(member)) {
        hasPrivateField = true
      } else if (t.isClassMethod(member) && member.kind === 'constructor') {
        ctorPath = memberPath as NodePath<t.ClassMethod>
      } else if (t.isClassMethod(member) && (member.kind === 'get' || member.kind === 'set')) {
        const name = plainKeyName(member.key)
        if (member.computed || name === null) {
          hasComputedAccessor = true
        } else {
          ;(member.static ? staticAccessorKeys : instanceAccessorKeys).add(name)
        }
      }
    }

    if (instanceFields.length === 0 && staticFields.length === 0) {
      return
    }
    if (
      !canDesugar(path, {
        instanceFields,
        staticFields,
        hasPrivateField,
        hasComputedAccessor,
        instanceAccessorKeys,
        staticAccessorKeys,
        ctorPath,
      })
    ) {
      return
    }

    // Path methods keep Babel's queued sibling paths aligned after each edit.
    for (const memberPath of memberPaths) {
      const member = memberPath.node
      if (!t.isClassProperty(member)) {
        continue
      }
      if (member.static) {
        memberPath.replaceWith(t.staticBlock([defineField(t.thisExpression(), member)]))
      } else {
        memberPath.remove()
      }
    }

    if (instanceFields.length > 0) {
      const installs = instanceFields.map((field) => defineField(t.thisExpression(), field))
      if (ctorPath) {
        ctorPath.get('body').unshiftContainer('body', installs)
      } else {
        path
          .get('body')
          .unshiftContainer(
            'body',
            t.classMethod(
              'constructor',
              t.identifier('constructor'),
              [],
              t.blockStatement(installs),
            ),
          )
      }
    }
  },
}

interface Collected {
  instanceFields: t.ClassProperty[]
  staticFields: t.ClassProperty[]
  hasPrivateField: boolean
  hasComputedAccessor: boolean
  instanceAccessorKeys: Set<string>
  staticAccessorKeys: Set<string>
  ctorPath: NodePath<t.ClassMethod> | null
}

function canDesugar(path: NodePath<t.Class>, c: Collected): boolean {
  if (c.hasPrivateField || c.hasComputedAccessor || path.node.superClass != null) {
    return false
  }
  // `with` and outer bindings can redirect the synthesized `Object` reference.
  if (isInsideWith(path) || objectIsShadowed(path, c.ctorPath)) {
    return false
  }
  if (c.instanceFields.length > 0 && c.ctorPath && !hasSimpleParams(c.ctorPath.node)) {
    return false
  }
  for (const field of c.instanceFields) {
    if (!instanceFieldIsSafe(field, c.ctorPath != null, c.instanceAccessorKeys)) {
      return false
    }
  }
  for (const field of c.staticFields) {
    if (!staticFieldIsSafe(field, c.staticAccessorKeys)) {
      return false
    }
  }
  return true
}

function objectIsShadowed(
  path: NodePath<t.Class>,
  ctorPath: NodePath<t.ClassMethod> | null,
): boolean {
  return (
    path.scope.getBinding('Object') != null ||
    (ctorPath != null && ctorPath.scope.getBinding('Object') != null)
  )
}

// ECMA-262 10.2.2 initializes base-class fields before parameter defaults.
// Moving fields into the body reverses that order for non-simple parameters.
function hasSimpleParams(ctor: t.ClassMethod): boolean {
  return ctor.params.every((param) => t.isIdentifier(param))
}

function instanceFieldIsSafe(
  field: t.ClassProperty,
  hasCtor: boolean,
  accessorKeys: Set<string>,
): boolean {
  if (field.computed || !isPlainKey(field.key) || isProtoKey(field.key)) {
    return false
  }
  if (shadowsAccessor(field.key, accessorKeys)) {
    return false
  }
  if (field.value != null && isAnonymousFunctionDefinition(field.value)) {
    return false
  }
  if (hasCtor) {
    // Only a literal cannot capture a constructor parameter or local.
    return field.value == null || isPrimitiveLiteral(field.value)
  }
  return field.value == null || !initObservesMethodContext(field.value, false)
}

function staticFieldIsSafe(field: t.ClassProperty, accessorKeys: Set<string>): boolean {
  if (field.computed || !isPlainKey(field.key) || isForbiddenStaticKey(field.key)) {
    return false
  }
  if (shadowsAccessor(field.key, accessorKeys)) {
    return false
  }
  if (field.value == null) {
    return true
  }
  if (isAnonymousFunctionDefinition(field.value)) {
    return false
  }
  // Static blocks can change how these context-sensitive forms resolve.
  return !containsPrivateName(field.value) && !initObservesMethodContext(field.value, true)
}

// CreateDataProperty ignores a same-named accessor. Lowering could reorder it.
function shadowsAccessor(key: t.Node, accessorKeys: Set<string>): boolean {
  const name = plainKeyName(key)
  return name !== null && accessorKeys.has(name)
}

function containsPrivateName(node: t.Node): boolean {
  let found = false
  t.traverseFast(node, (child) => {
    if (t.isPrivateName(child)) {
      found = true
    }
    return found ? t.traverseFast.stop : undefined
  })
  return found
}

// These descriptor flags match CreateDataProperty.
function defineField(target: t.Expression, field: t.ClassProperty): t.ExpressionStatement {
  return t.expressionStatement(
    t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('defineProperty')), [
      target,
      t.stringLiteral(plainKeyName(field.key)!),
      t.objectExpression([
        t.objectProperty(t.identifier('value'), fieldValue(field)),
        t.objectProperty(t.identifier('writable'), t.booleanLiteral(true)),
        t.objectProperty(t.identifier('enumerable'), t.booleanLiteral(true)),
        t.objectProperty(t.identifier('configurable'), t.booleanLiteral(true)),
      ]),
    ]),
  )
}

function fieldValue(field: t.ClassProperty): t.Expression {
  return field.value ?? t.unaryExpression('void', t.numericLiteral(0))
}

// Numeric and BigInt keys both pass through ToPropertyKey, so `1` and `1n`
// name `"1"`.
function plainKeyName(key: t.Node): string | null {
  if (t.isIdentifier(key)) {
    return key.name
  }
  if (t.isStringLiteral(key)) {
    return key.value
  }
  if (t.isNumericLiteral(key) || t.isBigIntLiteral(key)) {
    return String(key.value)
  }
  return null
}

function isPlainKey(key: t.Node): boolean {
  return plainKeyName(key) !== null
}

function isForbiddenStaticKey(key: t.Node): boolean {
  if (t.isIdentifier(key) || t.isStringLiteral(key)) {
    return FORBIDDEN_STATIC_KEYS.has(plainKeyName(key)!)
  }
  return false
}

// A descriptor would infer `"value"` instead of the field key as `.name`.
function isAnonymousFunctionDefinition(node: t.Node): boolean {
  return (
    t.isArrowFunctionExpression(node) ||
    (t.isFunctionExpression(node) && node.id == null) ||
    (t.isClassExpression(node) && node.id == null)
  )
}

// Relocation changes `new.target`, `super`, and static `this`. Nested non-arrow
// functions rebind them and do not count.
function initObservesMethodContext(node: t.Node, forbidThis: boolean): boolean {
  let found = false
  t.traverseFast(node, (child) => {
    if (t.isFunction(child) && !t.isArrowFunctionExpression(child)) {
      return t.traverseFast.skip
    }
    if (
      t.isSuper(child) ||
      (t.isMetaProperty(child) && child.meta.name === 'new' && child.property.name === 'target') ||
      (forbidThis && t.isThisExpression(child))
    ) {
      found = true
    }
    return found ? t.traverseFast.skip : undefined
  })
  return found
}
