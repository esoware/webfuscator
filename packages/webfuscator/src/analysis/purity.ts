import type { Scope } from '@babel/traverse'
import * as t from '@babel/types'

import { isPrimitiveLiteral } from '../utils/literal'

// Purity also requires deterministic repetition and no throw. Identifier reads
// need scope to prove resolution.
export function isPure(node: t.Node, scope?: Scope): boolean {
  if (
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isBigIntLiteral(node) ||
    t.isRegExpLiteral(node) ||
    t.isThisExpression(node)
  ) {
    return true
  }
  if (t.isIdentifier(node)) {
    return identifierReadIsSafe(node, scope)
  }
  if (t.isTemplateLiteral(node)) {
    // ToString can call object code or throw on Symbol.
    for (const expr of node.expressions) {
      if (!t.isExpression(expr) || primitiveLiteralKind(expr) === null) {
        return false
      }
    }
    return true
  }
  if (t.isUnaryExpression(node)) {
    // Numeric unary operators invoke ToPrimitive. `delete` and `throw` act.
    if (node.operator === '!' || node.operator === 'typeof' || node.operator === 'void') {
      return isPure(node.argument, scope)
    }
    return false
  }
  if (t.isBinaryExpression(node) && node.operator !== 'in' && node.operator !== 'instanceof') {
    if (!t.isExpression(node.left)) {
      return false
    }
    if (!isPure(node.left, scope) || !isPure(node.right, scope)) {
      return false
    }
    // Only strict equality avoids coercion. Other operators need safe literals.
    if (node.operator === '===' || node.operator === '!==') {
      return true
    }
    return coercesWithoutEffect(node.left, node.right, node.operator)
  }
  if (t.isLogicalExpression(node)) {
    return isPure(node.left, scope) && isPure(node.right, scope)
  }
  if (t.isConditionalExpression(node)) {
    return (
      isPure(node.test, scope) && isPure(node.consequent, scope) && isPure(node.alternate, scope)
    )
  }
  if (t.isSequenceExpression(node)) {
    for (const expr of node.expressions) {
      if (!isPure(expr, scope)) {
        return false
      }
    }
    return true
  }
  return false
}

// A droppable identifier read must resolve to a local binding or immutable
// global `undefined`.
export function isSideEffectFree(node: t.Node, scope?: Scope): boolean {
  if (
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isBigIntLiteral(node) ||
    t.isRegExpLiteral(node)
  ) {
    return true
  }
  if (t.isTemplateLiteral(node)) {
    // ToString can call object code or throw on Symbol.
    for (const expr of node.expressions) {
      if (!t.isExpression(expr) || primitiveLiteralKind(expr) === null) {
        return false
      }
    }
    return true
  }
  if (t.isIdentifier(node)) {
    return identifierReadIsSafe(node, scope)
  }
  if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
    return true
  }
  if (t.isClassExpression(node)) {
    // `extends` and computed keys run during class definition.
    if (node.superClass) {
      if (!isSideEffectFree(node.superClass, scope)) {
        return false
      }
      // ClassDefinitionEvaluation accepts only `null` or a constructor.
      if (!isConstructableSuperClass(node.superClass)) {
        return false
      }
    }
    for (const member of node.body.body) {
      // Static fields and blocks run during class definition.
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
        !isSideEffectFree(member.key, scope)
      ) {
        return false
      }
    }
    return true
  }
  if (t.isArrayExpression(node)) {
    for (const element of node.elements) {
      if (element === null) {
        continue
      }
      if (t.isSpreadElement(element)) {
        return false
      }
      if (!isSideEffectFree(element, scope)) {
        return false
      }
    }
    return true
  }
  if (t.isObjectExpression(node)) {
    for (const prop of node.properties) {
      if (t.isSpreadElement(prop)) {
        return false
      }
      if (t.isObjectMethod(prop)) {
        if (prop.computed && !isSideEffectFree(prop.key, scope)) {
          return false
        }
        continue
      }
      if (!t.isObjectProperty(prop)) {
        return false
      }
      if (prop.computed && !isSideEffectFree(prop.key, scope)) {
        return false
      }
      if (!t.isExpression(prop.value)) {
        return false
      }
      if (!isSideEffectFree(prop.value, scope)) {
        return false
      }
    }
    return true
  }
  if (t.isUnaryExpression(node)) {
    if (node.operator === 'delete' || node.operator === 'throw') {
      return false
    }
    if (node.operator === '!' || node.operator === 'typeof' || node.operator === 'void') {
      return isSideEffectFree(node.argument, scope)
    }
    return false
  }
  if (t.isBinaryExpression(node) && node.operator !== 'in' && node.operator !== 'instanceof') {
    if (!t.isExpression(node.left)) {
      return false
    }
    if (!isSideEffectFree(node.left, scope) || !isSideEffectFree(node.right, scope)) {
      return false
    }
    // Coercing operators need compatible literals that cannot throw.
    if (node.operator === '===' || node.operator === '!==') {
      return true
    }
    return coercesWithoutEffect(node.left, node.right, node.operator)
  }
  if (t.isLogicalExpression(node)) {
    return isSideEffectFree(node.left, scope) && isSideEffectFree(node.right, scope)
  }
  if (t.isConditionalExpression(node)) {
    return (
      isSideEffectFree(node.test, scope) &&
      isSideEffectFree(node.consequent, scope) &&
      isSideEffectFree(node.alternate, scope)
    )
  }
  if (t.isSequenceExpression(node)) {
    for (const expr of node.expressions) {
      if (!isSideEffectFree(expr, scope)) {
        return false
      }
    }
    return true
  }
  return false
}

// Unbound `undefined` is safe because the global property is immutable.
function identifierReadIsSafe(node: t.Identifier, scope: Scope | undefined): boolean {
  const isUndefinedName = node.name === 'undefined'
  if (!scope) {
    return isUndefinedName
  }
  return scope.getBinding(node.name) !== undefined || isUndefinedName
}

// Only `null` and plain function expressions are known-valid superclass values.
function isConstructableSuperClass(node: t.Node): boolean {
  if (t.isNullLiteral(node)) {
    return true
  }
  return t.isFunctionExpression(node) && !node.generator && !node.async
}

// Track BigInt separately because mixed arithmetic throws.
function primitiveLiteralKind(node: t.Node): 'bigint' | 'other' | null {
  if (t.isBigIntLiteral(node)) {
    return 'bigint'
  }
  return isPrimitiveLiteral(node) ? 'other' : null
}

// BigInt division, remainder, exponentiation, and unsigned shift can throw from
// values or operator support that the type alone cannot prove safe.
const THROWING_BIGINT_OPERATORS = new Set<string>(['/', '%', '**', '>>>'])

function coercesWithoutEffect(left: t.Node, right: t.Node, operator: string): boolean {
  const leftKind = primitiveLiteralKind(left)
  const rightKind = primitiveLiteralKind(right)
  if (leftKind === null || rightKind === null) {
    return false
  }
  // Mixed BigInt arithmetic throws.
  if (leftKind !== rightKind) {
    return false
  }
  return leftKind !== 'bigint' || !THROWING_BIGINT_OPERATORS.has(operator)
}
