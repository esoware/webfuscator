import { expect, test } from 'vitest'

import { updateToAssignment } from '../../src/transforms/update-to-assignment'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('update-to-assignment', updateToAssignment, {
  postfixStatement: {
    name: 'updateToAssignment rewrites a postfix i++ statement',
    input: `let i = 0;
i++;`,
  },
  prefixStatement: {
    name: 'updateToAssignment rewrites a prefix ++i statement',
    input: `let i = 0;
++i;`,
  },
  decrement: {
    name: 'updateToAssignment rewrites i-- to i -= 1',
    input: `let i = 5;
i--;`,
  },
  prefixValuePosition: {
    name: 'updateToAssignment rewrites a prefix update used as a value',
    input: `let i = 0;
const arr = [10, 20];
const v = arr[++i];`,
  },
  postfixValueUsedNoOp: {
    name: 'updateToAssignment leaves a postfix update whose value is used',
    input: `let i = 0;
const arr = [10, 20];
const v = arr[i++];`,
  },
  forUpdate: {
    name: 'updateToAssignment rewrites the update slot of a for header',
    input: `let sum = 0;
for (let i = 0; i < 3; i++) {
  sum += i;
}`,
  },
  bigintNoOp: {
    name: 'updateToAssignment leaves a BigInt counter alone',
    input: `let n = 5n;
n++;`,
  },
  reassignedMaybeBigintNoOp: {
    name: 'updateToAssignment leaves a counter that might become BigInt alone',
    input: `let x = 0;
if (globalThis.cond) x = 5n;
x++;`,
  },
  paramNoOp: {
    name: 'updateToAssignment leaves a parameter operand alone',
    input: `let out;
function f(x) {
  x++;
  return x;
}
out = f(3);`,
  },
  memberNoOp: {
    name: 'updateToAssignment leaves a member operand alone',
    input: `const o = { c: 0 };
o.c++;`,
  },
})

function evalWith(src: string, observe: string): unknown {
  // oxlint-disable-next-line no-new-func
  return new Function(`${src}\nreturn (${observe});`)()
}

function expectEquivalent(input: string, observe: string): string {
  const out = run(input, updateToAssignment)
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
  return out
}

test(cases.postfixStatement.name, () => {
  const out = expectEquivalent(cases.postfixStatement.input, 'i')
  expect(out).toContain('i += 1')
  expect(out).not.toContain('i++')
})

test(cases.prefixStatement.name, () => {
  const out = expectEquivalent(cases.prefixStatement.input, 'i')
  expect(out).toContain('i += 1')
  expect(out).not.toContain('++i')
})

test(cases.decrement.name, () => {
  const out = expectEquivalent(cases.decrement.input, 'i')
  expect(out).toContain('i -= 1')
})

test(cases.prefixValuePosition.name, () => {
  const out = expectEquivalent(cases.prefixValuePosition.input, '[i, v]')
  expect(out).toContain('arr[i += 1]')
  expect(evalWith(out, '[i, v]')).toEqual([1, 20])
})

test(cases.postfixValueUsedNoOp.name, () => {
  const out = expectEquivalent(cases.postfixValueUsedNoOp.input, '[i, v]')
  expect(out).toContain('arr[i++]')
  expect(evalWith(out, '[i, v]')).toEqual([1, 10])
})

test(cases.forUpdate.name, () => {
  const out = expectEquivalent(cases.forUpdate.input, 'sum')
  expect(out).toContain('i += 1')
  expect(evalWith(out, 'sum')).toBe(3)
})

test(cases.bigintNoOp.name, () => {
  const out = expectEquivalent(cases.bigintNoOp.input, 'n')
  expect(out).toContain('n++')
  expect(evalWith(out, 'n')).toBe(6n)
})

test(cases.reassignedMaybeBigintNoOp.name, () => {
  const out = run(cases.reassignedMaybeBigintNoOp.input, updateToAssignment)
  expect(out).toContain('x++')
  expect(out).not.toContain('x += 1')
})

test(cases.paramNoOp.name, () => {
  const out = expectEquivalent(cases.paramNoOp.input, 'out')
  expect(out).toContain('x++')
  expect(evalWith(out, 'out')).toBe(4)
})

test(cases.memberNoOp.name, () => {
  const out = expectEquivalent(cases.memberNoOp.input, 'o.c')
  expect(out).toContain('o.c++')
})

test('updateToAssignment leaves a for-in loop variable alone', () => {
  const src =
    'var out = []; for (var x = 0 in { a: 1, b: 2 }) { x++; out.push(x); } log(out.join(","));'
  const out = run(src, updateToAssignment)
  expect(out).toContain('x++')
  expect(trace(out)).toEqual(trace(src))
})

test('updateToAssignment leaves an update inside a with block or an eval function alone', () => {
  const withSrc = 'let x = 0; var o = { x: 5n }; with (o) { x++; } log(o.x);'
  expect(run(withSrc, updateToAssignment)).toContain('x++')
  expect(trace(run(withSrc, updateToAssignment))).toEqual(trace(withSrc))
  const evalSrc = 'let x = 0; eval("x = \'5\'"); x++; log(x);'
  expect(run(evalSrc, updateToAssignment)).toContain('x++')
  expect(trace(run(evalSrc, updateToAssignment))).toEqual(trace(evalSrc))
})

test('updateToAssignment leaves a counter a nested-scope eval can retype alone (A07-18)', () => {
  // A sibling direct eval can still retype captured `x` as BigInt.
  const src = 'var x = 0; function g() { eval("x = 5n"); } g(); x++; log(x);'
  const out = run(src, updateToAssignment)
  expect(out).toContain('x++')
  expect(out).not.toContain('x += 1')
  expect(trace(out)).toEqual(trace(src))
})
