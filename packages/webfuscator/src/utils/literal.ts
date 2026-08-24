import generate from '@babel/generator'
import * as t from '@babel/types'

const MAX_GENERATED_LITERAL_LENGTH = 8192
const MAX_LITERAL_DEPTH = 32
const MAX_LITERAL_NODES = 512
const MAX_STRING_LITERAL_LENGTH = 4096

// RegExp literals allocate mutable objects and are not primitive values.
export function isPrimitiveLiteral(node: t.Node): boolean {
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isBigIntLiteral(node)
  )
}

// `+bigint` is the only literal-shaped unary form that throws.
export function isLiteralShaped(node: t.Node): boolean {
  return literalShapeKind(node) !== null
}

// Unary minus and bitwise not preserve BigInt; unary plus throws on it.
function literalShapeKind(node: t.Node): 'bigint' | 'other' | null {
  if (t.isBigIntLiteral(node)) {
    return 'bigint'
  }
  if (isPrimitiveLiteral(node) || t.isRegExpLiteral(node)) {
    return 'other'
  }
  if (t.isUnaryExpression(node)) {
    const inner = literalShapeKind(node.argument)
    if (inner === null) {
      return null
    }
    if (node.operator === '!') {
      return 'other'
    }
    if (node.operator === '+') {
      return inner === 'bigint' ? null : 'other'
    }
    if (node.operator === '-' || node.operator === '~') {
      return inner
    }
  }
  return null
}

export function valueToLiteral(value: unknown): t.Expression | null {
  const literal = buildValueLiteral(value, new Set(), { nodesRemaining: MAX_LITERAL_NODES }, 0)
  if (!literal || generate(literal).code.length > MAX_GENERATED_LITERAL_LENGTH) {
    return null
  }
  return literal
}

interface LiteralBudget {
  nodesRemaining: number
}

function reserveLiteralNodes(budget: LiteralBudget, count: number): boolean {
  if (budget.nodesRemaining < count) {
    return false
  }
  budget.nodesRemaining -= count
  return true
}

function buildValueLiteral(
  value: unknown,
  seen: Set<object>,
  budget: LiteralBudget,
  depth: number,
): t.Expression | null {
  if (depth > MAX_LITERAL_DEPTH) {
    return null
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LITERAL_LENGTH || !reserveLiteralNodes(budget, 1)) {
      return null
    }
    return t.stringLiteral(value)
  }
  if (typeof value === 'boolean') {
    if (!reserveLiteralNodes(budget, 1)) {
      return null
    }
    return t.booleanLiteral(value)
  }
  if (value === null) {
    if (!reserveLiteralNodes(budget, 1)) {
      return null
    }
    return t.nullLiteral()
  }
  if (value === undefined) {
    if (!reserveLiteralNodes(budget, 2)) {
      return null
    }
    // `void 0` cannot be shadowed like the identifier `undefined`.
    return t.unaryExpression('void', t.numericLiteral(0))
  }
  if (typeof value === 'bigint') {
    // A UnaryExpression lets the generator parenthesize negative BigInt where
    // precedence requires it.
    if (value < 0n) {
      if (!reserveLiteralNodes(budget, 2)) {
        return null
      }
      return t.unaryExpression('-', t.bigIntLiteral(-value))
    }
    if (!reserveLiteralNodes(budget, 1)) {
      return null
    }
    return t.bigIntLiteral(value)
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return null
    }
    if (Object.is(value, -0)) {
      if (!reserveLiteralNodes(budget, 2)) {
        return null
      }
      return t.unaryExpression('-', t.numericLiteral(0))
    }
    if (value < 0) {
      if (!reserveLiteralNodes(budget, 2)) {
        return null
      }
      return t.unaryExpression('-', t.numericLiteral(-value))
    }
    if (!reserveLiteralNodes(budget, 1)) {
      return null
    }
    return t.numericLiteral(value)
  }
  if (Array.isArray(value)) {
    if (seen.has(value) || !arrayHasLiteralShape(value) || !reserveLiteralNodes(budget, 1)) {
      return null
    }
    seen.add(value)
    const elements: t.Expression[] = []
    for (const item of value) {
      const lit = buildValueLiteral(item, seen, budget, depth + 1)
      if (!lit) {
        return null
      }
      elements.push(lit)
    }
    return t.arrayExpression(elements)
  }
  return null
}

function arrayHasLiteralShape(value: unknown[]): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype || !Object.isExtensible(value)) {
    return false
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== value.length + 1 || names.at(-1) !== 'length') {
    return false
  }
  for (let index = 0; index < value.length; index++) {
    if (
      names[index] !== String(index) ||
      !isOrdinaryDataProperty(Object.getOwnPropertyDescriptor(value, String(index)))
    ) {
      return false
    }
  }
  return Object.getOwnPropertySymbols(value).length === 0
}

function isOrdinaryDataProperty(descriptor: PropertyDescriptor | undefined): boolean {
  return (
    descriptor !== undefined &&
    'value' in descriptor &&
    descriptor.configurable === true &&
    descriptor.enumerable === true &&
    descriptor.writable === true
  )
}
