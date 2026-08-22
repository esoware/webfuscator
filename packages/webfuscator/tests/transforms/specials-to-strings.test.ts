import { parse } from '@babel/parser'
import type { File } from '@babel/types'
import { expect, test } from 'vitest'

import { specialsToStrings } from '../../src/transforms/specials-to-strings'
import { defineCases, run, trace } from '../helpers'

const transform = (ast: File): void => {
  specialsToStrings(ast, { seed: 0, stringGeneratorMode: 'mangled' })
}

const cases = defineCases('specials-to-strings', transform, {
  booleanTrue: {
    name: 'specialsToStrings rewrites `true` as `!!"<random>"`',
    input: `var x = true;`,
  },
  booleanFalse: {
    name: 'specialsToStrings rewrites `false` as `!"<random>"`',
    input: `var x = false;`,
  },
  nanReference: {
    name: 'specialsToStrings rewrites `NaN` as `+"<random>"`',
    input: `var x = NaN;`,
  },
  infinityReference: {
    name: 'specialsToStrings rewrites `Infinity` as `1/!"<random>"`',
    input: `var x = Infinity;`,
  },
  undefinedReference: {
    name: 'specialsToStrings rewrites `undefined` as `void "<random>"`',
    input: `var x = undefined;`,
  },
  negativeInfinity: {
    name: 'specialsToStrings rewrites `-Infinity` to a parenthesised division so the negate binds correctly',
    input: `var x = -Infinity;`,
  },
  typeofUndefined: {
    name: 'specialsToStrings rewrites `typeof undefined` to `typeof void "<random>"` (still "undefined")',
    input: `var x = typeof undefined;`,
  },
  inComparison: {
    name: 'specialsToStrings keeps `x === undefined` semantics after rewriting both sides',
    input: `function f(x) { return x === undefined; }
var y = f();`,
  },
  shadowedUndefined: {
    name: 'specialsToStrings leaves a locally-shadowed `undefined` alone',
    input: `(function () { var undefined = 5; log(undefined); })();`,
  },
  shadowedNaN: {
    name: 'specialsToStrings leaves a locally-shadowed `NaN` alone',
    input: `(function (NaN) { return NaN; })(7);`,
  },
  deleteNaN: {
    name: 'specialsToStrings leaves `delete NaN` alone (delete on the rewritten unary has different semantics)',
    input: `var x = delete NaN;`,
  },
  propertyAccessNotTouched: {
    name: 'specialsToStrings leaves `obj.undefined` member access alone (property name, not a reference)',
    input: `var x = obj.undefined;`,
  },
  booleanObjectKey: {
    name: 'specialsToStrings leaves a non-computed boolean-named property key alone (parsed as Identifier, not BooleanLiteral)',
    input: `var x = { true: 1, false: 2 };`,
  },
  computedBooleanKey: {
    name: 'specialsToStrings rewrites a computed boolean key - both `[true]` and `[!!"x"]` stringify to "true"',
    input: `var x = { [true]: 1 };`,
  },
  mixedSpecials: {
    name: 'specialsToStrings rewrites every special in a single expression',
    input: `var x = [true, false, NaN, Infinity, undefined];`,
  },
})

test(cases.booleanTrue.name, () => {
  const out = run(cases.booleanTrue.input, transform)
  expect(out).toMatch(/=\s*!!"[^"]+"/)
  expect(out).not.toContain('true')
  expect(new Function(`${out}return x;`)()).toBe(true)
})

test(cases.booleanFalse.name, () => {
  const out = run(cases.booleanFalse.input, transform)
  expect(out).toMatch(/=\s*!"[^"]+"/)
  expect(out).not.toContain('false')
  expect(new Function(`${out}return x;`)()).toBe(false)
})

test(cases.nanReference.name, () => {
  const out = run(cases.nanReference.input, transform)
  expect(out).toMatch(/=\s*\+"[^"]+"/)
  expect(out).not.toMatch(/\bNaN\b/)
  expect(Number.isNaN(new Function(`${out}return x;`)())).toBe(true)
})

test(cases.infinityReference.name, () => {
  const out = run(cases.infinityReference.input, transform)
  expect(out).toMatch(/=\s*1\s*\/\s*!"[^"]+"/)
  expect(out).not.toMatch(/\bInfinity\b/)
  expect(new Function(`${out}return x;`)()).toBe(Infinity)
})

test(cases.undefinedReference.name, () => {
  const out = run(cases.undefinedReference.input, transform)
  expect(out).toMatch(/=\s*void\s+"[^"]+"/)
  expect(out).not.toMatch(/\bundefined\b/)
  expect(new Function(`${out}return x;`)()).toBeUndefined()
})

test(cases.negativeInfinity.name, () => {
  const out = run(cases.negativeInfinity.input, transform)
  expect(new Function(`${out}return x;`)()).toBe(-Infinity)
})

test(cases.typeofUndefined.name, () => {
  const out = run(cases.typeofUndefined.input, transform)
  expect(out).toMatch(/typeof\s+void\s+"[^"]+"/)
  expect(new Function(`${out}return x;`)()).toBe('undefined')
})

test(cases.inComparison.name, () => {
  const out = run(cases.inComparison.input, transform)
  expect(new Function(`${out}return y;`)()).toBe(true)
})

test(cases.shadowedUndefined.name, () => {
  const out = run(cases.shadowedUndefined.input, transform)
  expect(out).toContain('var undefined = 5')
  expect(out).toMatch(/log\(undefined\)/)
  const observed: unknown[] = []
  new Function('log', out)((v: unknown) => observed.push(v))
  expect(observed).toEqual([5])
})

test(cases.shadowedNaN.name, () => {
  const out = run(cases.shadowedNaN.input, transform)
  expect(out).toMatch(/function\s*\(NaN\)/)
  expect(out).toMatch(/return\s+NaN/)
})

test(cases.deleteNaN.name, () => {
  const out = run(cases.deleteNaN.input, transform)
  expect(out).toContain('delete NaN')
  expect(out).not.toContain('delete +"')
})

test(cases.propertyAccessNotTouched.name, () => {
  const out = run(cases.propertyAccessNotTouched.input, transform)
  expect(out).toContain('obj.undefined')
})

test(cases.booleanObjectKey.name, () => {
  const out = run(cases.booleanObjectKey.input, transform)
  expect(out).toMatch(/\btrue\s*:\s*1/)
  expect(out).toMatch(/\bfalse\s*:\s*2/)
})

test(cases.computedBooleanKey.name, () => {
  const out = run(cases.computedBooleanKey.input, transform)
  expect(out).toMatch(/\[!!"[^"]+"\]/)
  const obj = new Function(`${out}return x;`)() as Record<string, number>
  expect(obj['true']).toBe(1)
})

test(cases.mixedSpecials.name, () => {
  const out = run(cases.mixedSpecials.input, transform)
  for (const word of ['true', 'false', 'NaN', 'Infinity', 'undefined']) {
    expect(out).not.toMatch(new RegExp(`\\b${word}\\b`))
  }
  const arr = new Function(`${out}return x;`)() as [boolean, boolean, number, number, undefined]
  expect(arr[0]).toBe(true)
  expect(arr[1]).toBe(false)
  expect(Number.isNaN(arr[2])).toBe(true)
  expect(arr[3]).toBe(Infinity)
  expect(arr[4]).toBeUndefined()
})

test('specialsToStrings returns false when nothing changed', () => {
  const ast = parse(`var x = 1 + 2;`, { sourceType: 'unambiguous' })
  expect(specialsToStrings(ast, { seed: 0, stringGeneratorMode: 'mangled' })).toBe(false)
})

test('specialsToStrings returns true when at least one node was rewritten', () => {
  const ast = parse(`var x = true;`, { sourceType: 'unambiguous' })
  expect(specialsToStrings(ast, { seed: 0, stringGeneratorMode: 'mangled' })).toBe(true)
})

function expectPreservesBehavior(src: string): void {
  expect(trace(run(src, transform))).toEqual(trace(src))
}

test('specialsToStrings does not rewrite a special in a write position', () => {
  expect(() => run('Infinity++;', transform)).not.toThrow()
  expect(() => run('--Infinity;', transform)).not.toThrow()
  expect(() => run('NaN++;', transform)).not.toThrow()
  expect(() => run('undefined--;', transform)).not.toThrow()
  expect(() => run('for (undefined in { a: 1 }) log(undefined);', transform)).not.toThrow()
  expectPreservesBehavior('log(Infinity++);')
})

test('specialsToStrings does not rewrite a special shadowed by a with object', () => {
  expectPreservesBehavior('with ({ NaN: 1 }) { log(NaN); }')
  expectPreservesBehavior('with ({ undefined: 7 }) { log(undefined); }')
  expectPreservesBehavior('with ({ Infinity: 3 }) { log(Infinity); }')
})

test('specialsToStrings does not rewrite a special in a function with direct eval', () => {
  expectPreservesBehavior('(function () { eval("var undefined = 5"); log(undefined); })();')
  expectPreservesBehavior('(function () { eval("var NaN = 5"); log(NaN); })();')
})
