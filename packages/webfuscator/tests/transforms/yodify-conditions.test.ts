import { expect, test } from 'vitest'

import { yodifyConditions } from '../../src/transforms/yodify-conditions'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('yodify-conditions', yodifyConditions, {
  specStrictEq: {
    name: 'yodifyConditions yodifies a strict-equality comparison',
    input: `if (x === 1) {}`,
  },
  specStrictNeq: {
    name: 'yodifyConditions yodifies a strict-inequality comparison with a string literal',
    input: `if (name !== "foo") {}`,
  },
  specGt: {
    name: 'yodifyConditions yodifies a greater-than into less-than with operands swapped',
    input: `if (count > 5) {}`,
  },
  specLte: {
    name: 'yodifyConditions yodifies a less-than-or-equal into greater-than-or-equal with operands swapped',
    input: `if (idx <= 10) {}`,
  },

  looseEq: {
    name: 'yodifyConditions yodifies loose equality',
    input: `if (x == null) {}`,
  },
  looseNeq: {
    name: 'yodifyConditions yodifies loose inequality',
    input: `if (x != undefined) {}`,
  },
  ltSwap: {
    name: 'yodifyConditions swaps and flips < into >',
    input: `var f = x < 3;`,
  },
  gteSwap: {
    name: 'yodifyConditions swaps and flips >= into <=',
    input: `var f = x >= 3;`,
  },

  negativeNumber: {
    name: 'yodifyConditions treats a negative numeric literal as literal-shaped',
    input: `if (x === -5) {}`,
  },
  notLiteral: {
    name: 'yodifyConditions treats a negated literal as literal-shaped',
    input: `if (flag === !0) {}`,
  },

  alreadyYoda: {
    name: 'yodifyConditions leaves an already-yoda comparison alone',
    input: `if (1 === x) {}`,
  },
  bothLiteral: {
    name: 'yodifyConditions leaves a literal-vs-literal comparison alone',
    input: `if (1 === 2) {}`,
  },
  neitherLiteral: {
    name: 'yodifyConditions leaves a comparison with no literal alone',
    input: `if (a === b) {}`,
  },
  nonComparison: {
    name: 'yodifyConditions leaves arithmetic alone',
    input: `var s = x + 1;`,
  },
  instanceofUntouched: {
    name: 'yodifyConditions leaves instanceof alone',
    input: `if (e instanceof Error) {}`,
  },
  inUntouched: {
    name: 'yodifyConditions leaves the in operator alone',
    input: `if ("k" in obj) {}`,
  },
})

test(cases.specStrictEq.name, () => {
  expect(run(cases.specStrictEq.input, yodifyConditions)).toContain('1 === x')
})

test(cases.specStrictNeq.name, () => {
  expect(run(cases.specStrictNeq.input, yodifyConditions)).toContain('"foo" !== name')
})

test(cases.specGt.name, () => {
  expect(run(cases.specGt.input, yodifyConditions)).toContain('5 < count')
})

test(cases.specLte.name, () => {
  expect(run(cases.specLte.input, yodifyConditions)).toContain('10 >= idx')
})

test(cases.looseEq.name, () => {
  expect(run(cases.looseEq.input, yodifyConditions)).toContain('null == x')
})

test(cases.looseNeq.name, () => {
  expect(run(cases.looseNeq.input, yodifyConditions)).toContain('x != undefined')
})

test(cases.ltSwap.name, () => {
  expect(run(cases.ltSwap.input, yodifyConditions)).toContain('3 > x')
})

test(cases.gteSwap.name, () => {
  expect(run(cases.gteSwap.input, yodifyConditions)).toContain('3 <= x')
})

test(cases.negativeNumber.name, () => {
  expect(run(cases.negativeNumber.input, yodifyConditions)).toContain('-5 === x')
})

test(cases.notLiteral.name, () => {
  expect(run(cases.notLiteral.input, yodifyConditions)).toContain('!0 === flag')
})

test(cases.alreadyYoda.name, () => {
  expect(run(cases.alreadyYoda.input, yodifyConditions)).toContain('1 === x')
})

test(cases.bothLiteral.name, () => {
  expect(run(cases.bothLiteral.input, yodifyConditions)).toContain('1 === 2')
})

test(cases.neitherLiteral.name, () => {
  expect(run(cases.neitherLiteral.input, yodifyConditions)).toContain('a === b')
})

test(cases.nonComparison.name, () => {
  expect(run(cases.nonComparison.input, yodifyConditions)).toContain('x + 1')
})

test(cases.instanceofUntouched.name, () => {
  expect(run(cases.instanceofUntouched.input, yodifyConditions)).toContain('e instanceof Error')
})

test(cases.inUntouched.name, () => {
  expect(run(cases.inUntouched.input, yodifyConditions)).toContain('"k" in obj')
})

function expectPreservesBehavior(src: string): string {
  const out = run(src, yodifyConditions)
  expect(trace(out)).toEqual(trace(src))
  return out
}

test('yodifyConditions does not promote a throwing unary + on a BigInt', () => {
  const out = run(
    'function s(){ throw new RangeError("s"); } try { log(s() === +1n); } catch (error) { log("E", error.constructor.name); }',
    yodifyConditions,
  )
  expect(out).toContain('s() === +1n')
  expectPreservesBehavior(
    'function s(){ throw new RangeError("s"); } try { log(s() === +1n); } catch (error) { log("E", error.constructor.name); }',
  )
  expectPreservesBehavior(
    'function s(){ log("s"); return 1; } try { log(s() == +1n); } catch (error) { log("E", error.constructor.name); }',
  )
})

test('yodifyConditions does not swap a relational comparison against a regexp', () => {
  const src =
    'var saved = RegExp.prototype.toString; try { RegExp.prototype.toString = function () { log("r"); return "1"; }; var x = { valueOf: function () { log("x"); return 0; } }; log(x < /a/); } finally { RegExp.prototype.toString = saved; }'
  const out = run(src, yodifyConditions)
  expect(out).toContain('x < /a/')
  expectPreservesBehavior(src)
})

test('yodifyConditions still swaps equality against a regexp', () => {
  const out = run('if (x === /a/) {}', yodifyConditions)
  expect(out).toContain('/a/ === x')
})

// A05-22: Numeric coercion of a regexp invokes user code before the swap point.
test('yodifyConditions does not swap a coercing regexp unary across equality', () => {
  const src =
    'var saved = RegExp.prototype.toString; RegExp.prototype.toString = function () { log("re"); return "/a/"; }; try { var f = function () { log("f"); return -1; }; log(f() === ~/a/); } finally { RegExp.prototype.toString = saved; }'
  const out = run(src, yodifyConditions)
  expect(out).toContain('f() === ~/a/')
  expectPreservesBehavior(src)
})

test('yodifyConditions does not swap a coercing regexp unary across loose equality', () => {
  const src =
    'var saved = RegExp.prototype[Symbol.toPrimitive]; RegExp.prototype[Symbol.toPrimitive] = function () { log("re"); return 3; }; try { var f = function () { log("f"); return -3; }; log(f() == -/a/); } finally { if (saved === undefined) { delete RegExp.prototype[Symbol.toPrimitive]; } else { RegExp.prototype[Symbol.toPrimitive] = saved; } }'
  const out = run(src, yodifyConditions)
  expect(out).toContain('f() == -/a/')
  expectPreservesBehavior(src)
})
