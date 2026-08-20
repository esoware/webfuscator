import { parse } from '@babel/parser'
import { expect, test } from 'vitest'

import { numbersToStrings } from 'src/transforms/numbers-to-strings'

import { defineCases, run } from '../helpers'

const cases = defineCases('numbers-to-strings', numbersToStrings, {
  integerLiteral: {
    name: 'numbersToStrings wraps an integer literal in unary + with a string operand',
    input: `var x = 42;`,
  },
  floatLiteral: {
    name: 'numbersToStrings preserves a float literal through the round-trip',
    input: `var x = 0.5;`,
  },
  scientificLiteral: {
    name: 'numbersToStrings canonicalises a scientific-notation literal',
    input: `var x = 1e3;`,
  },
  hexLiteral: {
    name: 'numbersToStrings canonicalises a hex literal to decimal',
    input: `var x = 0xff;`,
  },
  insideArithmetic: {
    name: 'numbersToStrings rewrites every operand in an arithmetic chain',
    input: `var x = 1 + 2 * 3;`,
  },
  arrayIndex: {
    name: 'numbersToStrings rewrites a numeric array index',
    input: `var x = arr[5];`,
  },
  methodOnLiteral: {
    name: 'numbersToStrings keeps `42..toString()` callable by parenthesising the unary',
    input: `var x = 42..toString();`,
  },
  negative: {
    name: 'numbersToStrings drops the inner + when the literal is under a unary - (the - already coerces)',
    input: `var x = -5;`,
  },
  unaryPlus: {
    name: 'numbersToStrings does not double-wrap a literal already under a unary + (emits one + not two)',
    input: `var x = +5;`,
  },
  bitwiseNot: {
    name: 'numbersToStrings drops the inner + when the literal is under a unary ~ (~"5" === ~5)',
    input: `var x = ~5;`,
  },
  logicalNotKeepsWrap: {
    name: 'numbersToStrings keeps the wrap under unary ! because string truthiness differs from numeric',
    input: `var x = !0; var y = !1;`,
  },
  typeofKeepsWrap: {
    name: 'numbersToStrings keeps the wrap under typeof because typeof "5" is "string" not "number"',
    input: `var x = typeof 5;`,
  },
  bigIntUntouched: {
    name: 'numbersToStrings leaves BigInt literals alone (different node kind)',
    input: `var x = 42n;`,
  },
  underscoreSeparated: {
    name: 'numbersToStrings canonicalises underscore-separated numeric literals',
    input: `var x = 100_300_200;`,
  },
  underscoreFloat: {
    name: 'numbersToStrings canonicalises underscores in float and exponent forms',
    input: `var x = 1_000.500_5; var y = 1_000_000n; var z = 2_000e1_0;`,
  },
})

test(cases.integerLiteral.name, () => {
  const out = run(cases.integerLiteral.input, numbersToStrings)
  expect(out).toContain('+"42"')
  expect(out).not.toMatch(/= 42;/)
})

test(cases.floatLiteral.name, () => {
  const out = run(cases.floatLiteral.input, numbersToStrings)
  expect(out).toContain('+"0.5"')
  expect(new Function(`${out}return x;`)()).toBe(0.5)
})

test(cases.scientificLiteral.name, () => {
  const out = run(cases.scientificLiteral.input, numbersToStrings)
  expect(out).toContain('+"1000"')
  expect(new Function(`${out}return x;`)()).toBe(1000)
})

test(cases.hexLiteral.name, () => {
  const out = run(cases.hexLiteral.input, numbersToStrings)
  expect(out).toContain('+"255"')
  expect(new Function(`${out}return x;`)()).toBe(255)
})

test(cases.insideArithmetic.name, () => {
  const out = run(cases.insideArithmetic.input, numbersToStrings)
  expect(out).toContain('+"1"')
  expect(out).toContain('+"2"')
  expect(out).toContain('+"3"')
  expect(new Function(`${out}return x;`)()).toBe(7)
})

test(cases.arrayIndex.name, () => {
  const out = run(cases.arrayIndex.input, numbersToStrings)
  expect(out).toContain('arr[+"5"]')
  expect(new Function(`var arr = [0,10,20,30,40,50]; ${out}return x;`)()).toBe(50)
})

test(cases.methodOnLiteral.name, () => {
  const out = run(cases.methodOnLiteral.input, numbersToStrings)
  // Parentheses make member access bind to the coerced number.
  expect(out).toMatch(/\(\+"42"\)\.toString\(\)/)
  expect(new Function(`${out}return x;`)()).toBe('42')
})

test(cases.negative.name, () => {
  const out = run(cases.negative.input, numbersToStrings)
  expect(out).toContain('-"5"')
  expect(out).not.toContain('+"5"')
  expect(new Function(`${out}return x;`)()).toBe(-5)
})

test(cases.unaryPlus.name, () => {
  const out = run(cases.unaryPlus.input, numbersToStrings)
  expect(out).toContain('+"5"')
  expect(out).not.toContain('++"5"')
  expect(out).not.toContain('+ +"5"')
  expect(new Function(`${out}return x;`)()).toBe(5)
})

test(cases.bitwiseNot.name, () => {
  const out = run(cases.bitwiseNot.input, numbersToStrings)
  expect(out).toContain('~"5"')
  expect(out).not.toContain('+"5"')
  expect(new Function(`${out}return x;`)()).toBe(-6)
})

test(cases.logicalNotKeepsWrap.name, () => {
  const out = run(cases.logicalNotKeepsWrap.input, numbersToStrings)
  // A nonempty string has different truthiness from zero.
  expect(out).toContain('!+"0"')
  expect(out).toContain('!+"1"')
  const ctx = new Function(`${out}return [x, y];`)() as [boolean, boolean]
  expect(ctx).toEqual([true, false])
})

test(cases.typeofKeepsWrap.name, () => {
  const out = run(cases.typeofKeepsWrap.input, numbersToStrings)
  expect(out).toContain('typeof +"5"')
  expect(new Function(`${out}return x;`)()).toBe('number')
})

test(cases.bigIntUntouched.name, () => {
  const out = run(cases.bigIntUntouched.input, numbersToStrings)
  expect(out).toContain('42n')
  expect(out).not.toContain('"42n"')
})

test(cases.underscoreSeparated.name, () => {
  const out = run(cases.underscoreSeparated.input, numbersToStrings)
  // Numeric separators do not survive value stringification.
  expect(out).toContain('+"100300200"')
  expect(out).not.toContain('_')
  expect(new Function(`${out}return x;`)()).toBe(100300200)
})

test(cases.underscoreFloat.name, () => {
  const out = run(cases.underscoreFloat.input, numbersToStrings)
  expect(out).toContain('+"1000.5005"')
  // BigInt uses a different literal node and stays unchanged.
  expect(out).toMatch(/1_000_000n|1000000n/)
  // `2_000e1_0` has the value `2e13`.
  expect(out).toContain('+"20000000000000"')
  const ctx = new Function(`${out}return [x, y, z];`)() as [number, bigint, number]
  expect(ctx[0]).toBe(1000.5005)
  expect(ctx[1]).toBe(1000000n)
  expect(ctx[2]).toBe(2e13)
})

test('numbersToStrings returns false when nothing changed', () => {
  const ast = parse(`var x = "hi";`, { sourceType: 'unambiguous' })
  expect(numbersToStrings(ast)).toBe(false)
})

test('numbersToStrings returns true when at least one literal was rewritten', () => {
  const ast = parse(`var x = 1;`, { sourceType: 'unambiguous' })
  expect(numbersToStrings(ast)).toBe(true)
})

test('numbersToStrings does not wrap a non-computed class-field numeric key', () => {
  const out = run('var C = class { static 1 = 2; }; log(C[1]);', numbersToStrings)
  expect(out).toContain('static 1 =')
  expect(out).not.toContain('static +"1"')
  expect(() => new Function('log', out)).not.toThrow()
  const before = new Function('log', 'var C = class { static 1 = 2; }; log(C[1]);')
  const after = new Function('log', out)
  const b: unknown[] = []
  const a: unknown[] = []
  before((v: unknown) => b.push(v))
  after((v: unknown) => a.push(v))
  expect(a).toEqual(b)
})
