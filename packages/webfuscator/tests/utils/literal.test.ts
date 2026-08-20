import generate from '@babel/generator'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { expect, test } from 'vitest'

import { isLiteralShaped, valueToLiteral } from 'src/utils/literal'

// Evaluate generated literals to prove they parse and round-trip.
function roundTrip(value: unknown): unknown {
  const node = valueToLiteral(value)
  if (node === null) {
    throw new Error(`valueToLiteral returned null for: ${String(value)}`)
  }
  return new Function(`return (${generate(node).code});`)()
}

function expression(code: string): t.Expression {
  const ast = parse(code, { sourceType: 'unambiguous' })
  const [stmt] = ast.program.body
  if (!stmt || !t.isExpressionStatement(stmt)) {
    throw new Error(`not an expression statement: ${code}`)
  }
  return stmt.expression
}

// Embed and evaluate materialized values to catch precedence and parse failures.
function evalEmbedded(value: unknown, build: (lit: t.Expression) => t.Expression): unknown {
  const lit = valueToLiteral(value)
  if (lit === null) {
    throw new Error(`valueToLiteral returned null for: ${String(value)}`)
  }
  return new Function(`return (${generate(build(lit)).code});`)()
}

test('valueToLiteral round-trips every representable value through eval', () => {
  const values: unknown[] = [
    'hello',
    '',
    true,
    false,
    null,
    undefined,
    0,
    1,
    -1,
    3.14,
    -2.5,
    42n,
    -7n,
    [1, 2, 3],
    ['a', true, null],
    [[1], [2, [3]]],
    'x'.repeat(4096),
  ]
  for (const value of values) {
    expect(roundTrip(value)).toEqual(value)
  }
})

test('valueToLiteral preserves negative zero', () => {
  expect(Object.is(roundTrip(-0), -0)).toBe(true)
})

test('valueToLiteral round-trips large and negative bigints', () => {
  const values = [-1n, -7n, 9007199254740993n, -9007199254740993n, -(2n ** 64n)]
  for (const value of values) {
    expect(roundTrip(value)).toEqual(value)
  }
})

test('a materialized negative bigint is valid to the left of `**`', () => {
  // A negative BigInt base needs parentheses before exponentiation.
  expect(evalEmbedded(-1n, (lit) => t.binaryExpression('**', lit, t.bigIntLiteral(2n)))).toBe(1n)
})

test('a materialized negative number is valid to the left of `**`', () => {
  expect(evalEmbedded(-2, (lit) => t.binaryExpression('**', lit, t.numericLiteral(2)))).toBe(4)
  // Negative zero also needs parentheses before exponentiation.
  expect(evalEmbedded(-0, (lit) => t.binaryExpression('**', lit, t.numericLiteral(2)))).toBe(0)
})

test('a materialized negative bigint keeps its value as a member object', () => {
  // Without parentheses, member access binds before the negative BigInt sign.
  const result = evalEmbedded(-1n, (lit) =>
    t.unaryExpression(
      'typeof',
      t.callExpression(t.memberExpression(lit, t.stringLiteral('toString'), true), []),
    ),
  )
  expect(result).toBe('string')
})

test('valueToLiteral returns null for values with no literal form', () => {
  expect(valueToLiteral(Number.NaN)).toBeNull()
  expect(valueToLiteral(Number.POSITIVE_INFINITY)).toBeNull()
  expect(valueToLiteral(Number.NEGATIVE_INFINITY)).toBeNull()
  expect(valueToLiteral('x'.repeat(4097))).toBeNull()
  expect(valueToLiteral(() => {})).toBeNull()
  expect(valueToLiteral({ a: 1 })).toBeNull()
  expect(valueToLiteral(Symbol('s'))).toBeNull()
  expect(valueToLiteral([1, () => {}])).toBeNull()
})

test('isLiteralShaped accepts literals and unary chains over literals', () => {
  const shaped = [
    '5',
    '("s")',
    'true',
    'null',
    '5n',
    '/re/',
    '-5',
    '+5',
    '~5',
    '!true',
    '-(-5)',
    '!!"x"',
  ]
  for (const code of shaped) {
    expect(isLiteralShaped(expression(code))).toBe(true)
  }
})

test('isLiteralShaped rejects identifiers, calls, and non-literal-shaped operators', () => {
  const notShaped = ['x', 'f()', 'a.b', '-x', 'void 0', 'typeof 1', '1 + 2', '[1]', '({})']
  for (const code of notShaped) {
    expect(isLiteralShaped(expression(code))).toBe(false)
  }
})
