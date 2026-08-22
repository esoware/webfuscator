import { expect, test } from 'vitest'

import { nullishCoalescingToTernary } from '../../src/transforms/nullish-coalescing-to-ternary'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('nullish-coalescing-to-ternary', nullishCoalescingToTernary, {
  boundIdentLeft: {
    name: 'nullishCoalescingToTernary rewrites a bound-identifier left operand without caching',
    input: `var a;
var x = a ?? b;`,
  },
  sideEffectLeft: {
    name: 'nullishCoalescingToTernary caches a side-effectful left operand into a temp',
    input: `var x = get() ?? fallback;`,
  },
  memberLeft: {
    name: 'nullishCoalescingToTernary caches a member-expression left operand',
    input: `var x = obj.prop ?? fallback;`,
  },
  leavesAndOrAlone: {
    name: 'nullishCoalescingToTernary leaves && and || alone',
    input: `var x = a && b;
var y = c || d;`,
  },
})

test(cases.boundIdentLeft.name, () => {
  const out = run(cases.boundIdentLeft.input, nullishCoalescingToTernary)
  expect(out).not.toContain('??')
  expect(out).not.toMatch(/\?[^?]/)
  expect(out).toMatch(/var x = a;\s*if \(x == null\)/)
})

test(cases.sideEffectLeft.name, () => {
  const out = run(cases.sideEffectLeft.input, nullishCoalescingToTernary)
  expect(out).not.toContain('??')

  const runOnce = (returnValue: string): { x: unknown; calls: number } =>
    new Function(
      `var calls = 0;
       function get() { calls++; return ${returnValue}; }
       var fallback = 'fb';
       ${out}
       return { x: x, calls: calls };`,
    )() as { x: unknown; calls: number }
  expect(runOnce(`'val'`)).toEqual({ x: 'val', calls: 1 })
  expect(runOnce('null')).toEqual({ x: 'fb', calls: 1 })
  expect(runOnce('undefined')).toEqual({ x: 'fb', calls: 1 })
  expect(runOnce('0')).toEqual({ x: 0, calls: 1 })
})

test(cases.memberLeft.name, () => {
  const out = run(cases.memberLeft.input, nullishCoalescingToTernary)
  expect(out).not.toContain('??')

  const runOnce = (propValue: string): { x: unknown; reads: number } =>
    new Function(
      `var reads = 0;
       var obj = Object.defineProperty({}, 'prop', {
         get: function () { reads++; return ${propValue}; },
       });
       var fallback = 'fb';
       ${out}
       return { x: x, reads: reads };`,
    )() as { x: unknown; reads: number }
  expect(runOnce(`'val'`)).toEqual({ x: 'val', reads: 1 })
  expect(runOnce('null')).toEqual({ x: 'fb', reads: 1 })
  expect(runOnce('undefined')).toEqual({ x: 'fb', reads: 1 })
})

test(cases.leavesAndOrAlone.name, () => {
  const out = run(cases.leavesAndOrAlone.input, nullishCoalescingToTernary)
  expect(out).toContain('a && b')
  expect(out).toContain('c || d')
})

function nullishPreserves(code: string): void {
  expect(trace(run(code, nullishCoalescingToTernary))).toEqual(trace(code))
}

test('nullishCoalescingToTernary declarator does not let the right operand observe the target (A07-12)', () => {
  const out = run('var x = null ?? x;\nlog(x);', nullishCoalescingToTernary)
  // Write lowering would make the right side read the newly written target.
  expect(out).not.toMatch(/var x = null;\s*if/)
  nullishPreserves('var x = null ?? x;\nlog(x);')
})

test('nullishCoalescingToTernary leaves a with-shadowed read intact (A07-15/16)', () => {
  nullishPreserves(`var a;
var o = { get a() { log('get'); return { b: 1 }; } };
with (o) { log(a ?? 'fb'); }`)
})
