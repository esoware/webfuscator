import type { Binding, NodePath, Scope } from '@babel/traverse'
import * as t from '@babel/types'

import {
  declarationReaches,
  initializerReaches,
  readCrossesFunctionBoundary,
} from 'src/analysis/document-order'
import { isSideEffectFree } from 'src/analysis/purity'
import { enclosingScopeHasDirectEval, isInsideWith } from 'src/utils/ast'

export type Evaluation = { known: true; value: unknown } | { known: false }

const UNKNOWN: Evaluation = { known: false }

// Regexp, function, and class values are known only to be truthy. Identity,
// contents, coercion, and `typeof` remain unknown.
const OPAQUE_TRUTHY = Symbol('opaque-truthy')

export function isOpaque(value: unknown): boolean {
  return value === OPAQUE_TRUTHY
}

interface Env {
  scope: Scope | undefined
  seen: Set<Binding>
  // Use the binding path while recursing so later declarations still hit TDZ.
  referencePath: NodePath | undefined
}

type Evaluator = (node: t.Node, env: Env) => Evaluation

const EVALUATORS: Partial<Record<t.Node['type'], Evaluator>> = {
  NumericLiteral: (node) => ({ known: true, value: (node as t.NumericLiteral).value }),
  StringLiteral: (node) => ({ known: true, value: (node as t.StringLiteral).value }),
  BooleanLiteral: (node) => ({ known: true, value: (node as t.BooleanLiteral).value }),
  NullLiteral: () => ({ known: true, value: null }),
  BigIntLiteral: (node) => {
    try {
      return { known: true, value: BigInt((node as t.BigIntLiteral).value) }
    } catch {
      return UNKNOWN
    }
  },
  RegExpLiteral: () => ({ known: true, value: OPAQUE_TRUTHY }),
  TemplateLiteral: (node) => {
    const template = node as t.TemplateLiteral
    if (template.expressions.length > 0) {
      return UNKNOWN
    }
    const [quasi] = template.quasis
    return { known: true, value: quasi?.value.cooked ?? quasi?.value.raw ?? '' }
  },
  UnaryExpression: evaluateUnary,
  BinaryExpression: evaluateBinary,
  LogicalExpression: evaluateLogical,
  ConditionalExpression: evaluateConditional,
  Identifier: evaluateIdentifier,
}

export function evaluateConstant(
  node: t.Node,
  scope?: Scope,
  referencePath?: NodePath,
): Evaluation {
  return run(node, { scope, seen: new Set(), referencePath })
}

function run(node: t.Node, env: Env): Evaluation {
  const evaluator = EVALUATORS[node.type]
  return evaluator ? evaluator(node, env) : UNKNOWN
}

function evaluateUnary(node: t.Node, env: Env): Evaluation {
  const unary = node as t.UnaryExpression
  if (unary.operator === 'void') {
    return isSideEffectFree(unary.argument, env.scope, env.referencePath)
      ? { known: true, value: undefined }
      : UNKNOWN
  }
  if (unary.operator === 'delete' || unary.operator === 'throw') {
    return UNKNOWN
  }
  const argument = run(unary.argument, env)
  if (!argument.known) {
    return UNKNOWN
  }
  return applyUnary(unary.operator, argument.value)
}

function evaluateBinary(node: t.Node, env: Env): Evaluation {
  const binary = node as t.BinaryExpression
  if (binary.operator === 'in' || binary.operator === 'instanceof') {
    return UNKNOWN
  }
  if (!t.isExpression(binary.left)) {
    return UNKNOWN
  }
  const left = run(binary.left, env)
  if (!left.known) {
    return UNKNOWN
  }
  const right = run(binary.right, env)
  if (!right.known) {
    return UNKNOWN
  }
  return applyBinary(binary.operator, left.value, right.value)
}

function evaluateLogical(node: t.Node, env: Env): Evaluation {
  const logical = node as t.LogicalExpression
  const left = run(logical.left, env)
  if (!left.known) {
    return UNKNOWN
  }
  if (logical.operator === '&&') {
    return left.value ? run(logical.right, env) : left
  }
  if (logical.operator === '||') {
    return left.value ? left : run(logical.right, env)
  }
  if (logical.operator === '??') {
    return left.value === null || left.value === undefined ? run(logical.right, env) : left
  }
  return UNKNOWN
}

function evaluateConditional(node: t.Node, env: Env): Evaluation {
  const conditional = node as t.ConditionalExpression
  const test = run(conditional.test, env)
  if (!test.known) {
    return UNKNOWN
  }
  return run(test.value ? conditional.consequent : conditional.alternate, env)
}

function evaluateIdentifier(node: t.Node, env: Env): Evaluation {
  const identifier = node as t.Identifier

  if (!env.scope) {
    return UNKNOWN
  }

  // `with` and direct `eval` can redirect names outside Babel's scope table.
  if (
    env.referencePath &&
    (isInsideWith(env.referencePath) || enclosingScopeHasDirectEval(env.referencePath))
  ) {
    return UNKNOWN
  }
  const binding = env.scope.getBinding(identifier.name)

  // Only an unbound `undefined` names the immutable global property.
  if (identifier.name === 'undefined') {
    return binding ? UNKNOWN : { known: true, value: undefined }
  }

  if (!binding || env.seen.has(binding)) {
    return UNKNOWN
  }

  if (t.isFunctionDeclaration(binding.path.node)) {
    return binding.constant ? { known: true, value: OPAQUE_TRUTHY } : UNKNOWN
  }
  if (t.isClassDeclaration(binding.path.node)) {
    if (!binding.constant) {
      return UNKNOWN
    }
    // A nested function can read the class before its declaration runs.
    if (readCrossesFunctionBoundary(binding, env.referencePath)) {
      return UNKNOWN
    }
    return declarationReaches(binding.path, env.referencePath)
      ? { known: true, value: OPAQUE_TRUTHY }
      : UNKNOWN
  }

  if (binding.kind === 'var' || binding.kind === 'let' || binding.kind === 'const') {
    const declarator = binding.path.node
    if (!t.isVariableDeclarator(declarator) || !declarator.init) {
      return UNKNOWN
    }
    if (!t.isIdentifier(declarator.id) || declarator.id.name !== identifier.name) {
      return UNKNOWN
    }
    // A nested function can read the binding before its initializer runs.
    if (readCrossesFunctionBoundary(binding, env.referencePath)) {
      return UNKNOWN
    }
    // A preceding `var` initializer may still sit on an untaken branch.
    if (!initializerReaches(binding.path, env.referencePath)) {
      return UNKNOWN
    }
    // Babel counts a looped `var` initializer as its own constant violation.
    if (
      !binding.constant &&
      !(
        binding.constantViolations.length === 1 &&
        binding.constantViolations[0]!.node === declarator
      )
    ) {
      return UNKNOWN
    }
    return run(declarator.init, {
      scope: binding.scope,
      seen: new Set([...env.seen, binding]),
      referencePath: binding.path,
    })
  }

  return UNKNOWN
}

function applyUnary(op: t.UnaryExpression['operator'], value: unknown): Evaluation {
  if (isOpaque(value)) {
    // Only truthiness is known for an opaque object.
    return op === '!' ? { known: true, value: false } : UNKNOWN
  }
  // `+bigint` throws TypeError; folding it would erase the throw.
  if (op === '+' && typeof value === 'bigint') {
    return UNKNOWN
  }
  try {
    switch (op) {
      case '!':
        return { known: true, value: !value }
      case '+':
        return { known: true, value: Number(value as number) }
      case '-':
        return { known: true, value: -(value as number) }
      case '~':
        return { known: true, value: ~(value as number) }
      case 'typeof':
        return { known: true, value: typeof value }
    }
  } catch {
    return UNKNOWN
  }
  return UNKNOWN
}

function applyBinary(
  op: t.BinaryExpression['operator'],
  left: unknown,
  right: unknown,
): Evaluation {
  // Binary operators observe more than an opaque object's truthiness.
  if (isOpaque(left) || isOpaque(right)) {
    return UNKNOWN
  }
  if (op === '===') {
    return { known: true, value: left === right }
  }
  if (op === '!==') {
    return { known: true, value: left !== right }
  }
  if (op === '==') {
    return { known: true, value: looseEquals(left, right) }
  }
  if (op === '!=') {
    return { known: true, value: !looseEquals(left, right) }
  }

  const a = left as number
  const b = right as number
  try {
    switch (op) {
      case '+':
        return { known: true, value: a + b }
      case '-':
        return { known: true, value: a - b }
      case '*':
        return { known: true, value: a * b }
      case '/':
        return { known: true, value: a / b }
      case '%':
        return { known: true, value: a % b }
      case '**':
        return { known: true, value: a ** b }
      case '&':
        return { known: true, value: a & b }
      case '|':
        return { known: true, value: a | b }
      case '^':
        return { known: true, value: a ^ b }
      case '<<':
        return { known: true, value: a << b }
      case '>>':
        return { known: true, value: a >> b }
      case '>>>':
        return { known: true, value: a >>> b }
      case '<':
        return { known: true, value: a < b }
      case '<=':
        return { known: true, value: a <= b }
      case '>':
        return { known: true, value: a > b }
      case '>=':
        return { known: true, value: a >= b }
    }
  } catch {
    return UNKNOWN
  }
  return UNKNOWN
}

function looseEquals(left: unknown, right: unknown): boolean {
  // oxlint-disable-next-line eqeqeq
  return (left as object) == (right as object)
}
