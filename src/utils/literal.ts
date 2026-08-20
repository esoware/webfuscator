import * as t from '@babel/types'

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
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LITERAL_LENGTH) {
      return null
    }
    return t.stringLiteral(value)
  }
  if (typeof value === 'boolean') {
    return t.booleanLiteral(value)
  }
  if (value === null) {
    return t.nullLiteral()
  }
  if (value === undefined) {
    // `void 0` cannot be shadowed like the identifier `undefined`.
    return t.unaryExpression('void', t.numericLiteral(0))
  }
  if (typeof value === 'bigint') {
    // A UnaryExpression lets the generator parenthesize negative BigInt where
    // precedence requires it.
    if (value < 0n) {
      return t.unaryExpression('-', t.bigIntLiteral(-value))
    }
    return t.bigIntLiteral(value)
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return null
    }
    if (Object.is(value, -0)) {
      return t.unaryExpression('-', t.numericLiteral(0))
    }
    if (value < 0) {
      return t.unaryExpression('-', t.numericLiteral(-value))
    }
    return t.numericLiteral(value)
  }
  if (Array.isArray(value)) {
    const elements: t.Expression[] = []
    for (const item of value) {
      const lit = valueToLiteral(item)
      if (!lit) {
        return null
      }
      elements.push(lit)
    }
    return t.arrayExpression(elements)
  }
  return null
}
