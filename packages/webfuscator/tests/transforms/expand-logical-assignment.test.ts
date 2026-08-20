import { expect, test } from 'vitest'

import { expandLogicalAssignment } from 'src/transforms/expand-logical-assignment'

import { defineCases, run, trace } from '../helpers'

const cases = defineCases('expand-logical-assignment', expandLogicalAssignment, {
  identOr: {
    name: 'expandLogicalAssignment rewrites a ||= on an identifier',
    input: `a ||= b;`,
  },
  identAnd: {
    name: 'expandLogicalAssignment rewrites a &&= on an identifier',
    input: `a &&= b;`,
  },
  identNullish: {
    name: 'expandLogicalAssignment rewrites a ??= on an identifier',
    input: `a ??= b;`,
  },

  memberDot: {
    name: 'expandLogicalAssignment caches the receiver of a dot member ||=',
    input: `obj.x ||= y;`,
  },
  memberComputedConstantKey: {
    name: 'expandLogicalAssignment leaves a constant computed key uncached',
    input: `arr["x"] ||= y;`,
  },
  memberComputedSideEffectfulKey: {
    name: 'expandLogicalAssignment caches both the receiver and a side-effectful computed key',
    input: `arr[idx()] ??= v;`,
  },
  memberSideEffectfulReceiver: {
    name: 'expandLogicalAssignment caches a side-effectful receiver',
    input: `getObj().x &&= y;`,
  },

  plainAssignment: {
    name: 'expandLogicalAssignment leaves plain assignment alone',
    input: `a = b;
a += 1;`,
  },
})

test(cases.identOr.name, () => {
  expect(run(cases.identOr.input, expandLogicalAssignment)).toContain('a || (a = b)')
})

test(cases.identAnd.name, () => {
  expect(run(cases.identAnd.input, expandLogicalAssignment)).toContain('a && (a = b)')
})

test(cases.identNullish.name, () => {
  expect(run(cases.identNullish.input, expandLogicalAssignment)).toContain('a ?? (a = b)')
})

test(cases.memberDot.name, () => {
  const out = run(cases.memberDot.input, expandLogicalAssignment)
  expect(out).toMatch(/\(_obj\d* = obj\)\.x \|\| \(_obj\d*\.x = y\)/)
})

test(cases.memberComputedConstantKey.name, () => {
  const out = run(cases.memberComputedConstantKey.input, expandLogicalAssignment)
  expect(out).toContain('||')
  expect(out).not.toContain('||=')
})

test(cases.memberComputedSideEffectfulKey.name, () => {
  const out = run(cases.memberComputedSideEffectfulKey.input, expandLogicalAssignment)
  expect(out).toContain('?? (')
  expect(out).toMatch(/_idx\d* = idx\(\)/)
})

test(cases.memberSideEffectfulReceiver.name, () => {
  const out = run(cases.memberSideEffectfulReceiver.input, expandLogicalAssignment)
  expect(out).toMatch(/\(_getObj\d*[^)]* = getObj\(\)\)\.x && \(_getObj\d*[^)]*\.x = y\)/)
})

test(cases.plainAssignment.name, () => {
  const out = run(cases.plainAssignment.input, expandLogicalAssignment)
  expect(out).toContain('a = b')
  expect(out).toContain('a += 1')
})

function logicalAssignmentPreserves(code: string): void {
  expect(trace(run(code, expandLogicalAssignment))).toEqual(trace(code))
}

test('expandLogicalAssignment does not duplicate a with-shadowed object read', () => {
  const src = `var a;
var holder = { n: 0 };
var o = { get a() { log('get'); return holder; } };
with (o) { a.n ||= 5; }
log(holder.n);`
  // `with` can make a duplicated object read invoke its getter twice.
  expect(run(src, expandLogicalAssignment)).toContain('a.n ||= 5')
  logicalAssignmentPreserves(src)
})
