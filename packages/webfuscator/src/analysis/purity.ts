import type { Binding, NodePath, Scope } from '@babel/traverse'
import * as t from '@babel/types'

import { isInsideWith } from '../utils/ast'
import { isPrimitiveLiteral } from '../utils/literal'
import {
  declarationReaches,
  initializerReaches,
  readCrossesFunctionBoundary,
} from './document-order'

// Purity also requires deterministic repetition and no throw. Identifier reads
// need scope and reference paths to prove resolution, initialization, and the
// absence of `with` interception.
export function isPure(node: t.Node, scope?: Scope, referencePath?: NodePath): boolean {
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
    return identifierReadIsSafe(node, scope, referencePath)
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
      return isPure(node.argument, scope, referencePath)
    }
    return false
  }
  if (t.isBinaryExpression(node) && node.operator !== 'in' && node.operator !== 'instanceof') {
    if (!t.isExpression(node.left)) {
      return false
    }
    if (!isPure(node.left, scope, referencePath) || !isPure(node.right, scope, referencePath)) {
      return false
    }
    // Only strict equality avoids coercion. Other operators need safe literals.
    if (node.operator === '===' || node.operator === '!==') {
      return true
    }
    return coercesWithoutEffect(node.left, node.right, node.operator)
  }
  if (t.isLogicalExpression(node)) {
    return isPure(node.left, scope, referencePath) && isPure(node.right, scope, referencePath)
  }
  if (t.isConditionalExpression(node)) {
    return (
      isPure(node.test, scope, referencePath) &&
      isPure(node.consequent, scope, referencePath) &&
      isPure(node.alternate, scope, referencePath)
    )
  }
  if (t.isSequenceExpression(node)) {
    for (const expr of node.expressions) {
      if (!isPure(expr, scope, referencePath)) {
        return false
      }
    }
    return true
  }
  return false
}

// A droppable identifier read must resolve after binding initialization.
export function isSideEffectFree(node: t.Node, scope?: Scope, referencePath?: NodePath): boolean {
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
    return identifierReadIsSafe(node, scope, referencePath)
  }
  if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
    return true
  }
  if (t.isClassExpression(node)) {
    // `extends` and computed keys run during class definition.
    if (node.superClass) {
      if (!isSideEffectFree(node.superClass, scope, referencePath)) {
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
        !isSideEffectFree(member.key, scope, referencePath)
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
      if (!isSideEffectFree(element, scope, referencePath)) {
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
        if (prop.computed && !isSideEffectFree(prop.key, scope, referencePath)) {
          return false
        }
        continue
      }
      if (!t.isObjectProperty(prop)) {
        return false
      }
      if (prop.computed && !isSideEffectFree(prop.key, scope, referencePath)) {
        return false
      }
      if (!t.isExpression(prop.value)) {
        return false
      }
      if (!isSideEffectFree(prop.value, scope, referencePath)) {
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
      return isSideEffectFree(node.argument, scope, referencePath)
    }
    return false
  }
  if (t.isBinaryExpression(node) && node.operator !== 'in' && node.operator !== 'instanceof') {
    if (!t.isExpression(node.left)) {
      return false
    }
    if (
      !isSideEffectFree(node.left, scope, referencePath) ||
      !isSideEffectFree(node.right, scope, referencePath)
    ) {
      return false
    }
    // Coercing operators need compatible literals that cannot throw.
    if (node.operator === '===' || node.operator === '!==') {
      return true
    }
    return coercesWithoutEffect(node.left, node.right, node.operator)
  }
  if (t.isLogicalExpression(node)) {
    return (
      isSideEffectFree(node.left, scope, referencePath) &&
      isSideEffectFree(node.right, scope, referencePath)
    )
  }
  if (t.isConditionalExpression(node)) {
    return (
      isSideEffectFree(node.test, scope, referencePath) &&
      isSideEffectFree(node.consequent, scope, referencePath) &&
      isSideEffectFree(node.alternate, scope, referencePath)
    )
  }
  if (t.isSequenceExpression(node)) {
    for (const expr of node.expressions) {
      if (!isSideEffectFree(expr, scope, referencePath)) {
        return false
      }
    }
    return true
  }
  return false
}

// A safe read needs a resolved, initialized binding outside `with`. Unbound
// `undefined` is safe because the global property is immutable.
function identifierReadIsSafe(
  node: t.Identifier,
  scope: Scope | undefined,
  referencePath: NodePath | undefined,
): boolean {
  // A `with` property can shadow any name, including `undefined`.
  if (referencePath && isInsideWith(referencePath)) {
    return false
  }
  const isUndefinedName = node.name === 'undefined'
  if (!scope) {
    return isUndefinedName
  }
  const binding = scope.getBinding(node.name)
  if (!binding) {
    return isUndefinedName
  }
  if (t.isFunctionDeclaration(binding.path.node) || binding.kind === 'module') {
    return true
  }
  if (binding.kind === 'param') {
    // Earlier parameter defaults can read later parameters in TDZ.
    if (!referencePath || !readIsInOwnParamList(binding, referencePath)) {
      return true
    }
    return declarationReaches(binding.path, referencePath)
  }
  // Lexical reads need an unconditionally reached declaration in the same call.
  if (isLexicalBinding(binding)) {
    if (referencePath && readCrossesFunctionBoundary(binding, referencePath)) {
      return false
    }
    return initializerReaches(binding.path, referencePath)
  }
  return declarationReaches(binding.path, referencePath)
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

function isLexicalBinding(binding: Binding): boolean {
  return (
    binding.kind === 'let' || binding.kind === 'const' || t.isClassDeclaration(binding.path.node)
  )
}

function readIsInOwnParamList(binding: Binding, referencePath: NodePath): boolean {
  const owner = binding.scope.block
  let current: NodePath | null = referencePath
  while (current) {
    const parent: NodePath | null = current.parentPath
    if (parent && parent.node === owner && current.listKey === 'params') {
      return true
    }
    current = parent
  }
  return false
}
