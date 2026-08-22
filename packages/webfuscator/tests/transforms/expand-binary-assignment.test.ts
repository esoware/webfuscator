import { expect, test } from 'vitest'

import { expandBinaryAssignment } from '../../src/transforms/expand-binary-assignment'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('expand-binary-assignment', expandBinaryAssignment, {
  identArith: {
    name: 'expandBinaryAssignment rewrites a += on an identifier',
    input: `let x = 1;
x += 2;`,
  },
  allOps: {
    name: 'expandBinaryAssignment rewrites every arithmetic and bitwise compound operator',
    input: `let a = 20, b = 20, c = 20, d = 20, e = 20, f = 20, g = 20, h = 20, i = 20, j = 20, k = 20;
a -= 3;
b *= 3;
c /= 4;
d %= 7;
e **= 2;
f <<= 2;
g >>= 1;
h >>>= 1;
i &= 6;
j |= 1;
k ^= 5;`,
  },
  stringConcat: {
    name: 'expandBinaryAssignment rewrites += string concatenation',
    input: `let s = "a";
s += "b" + "c";`,
  },
  memberReceiverOnce: {
    name: 'expandBinaryAssignment evaluates a side-effectful receiver once',
    input: `let calls = 0;
const obj = { x: 10 };
function getObj() {
  calls++;
  return obj;
}
getObj().x *= 3;`,
  },
  computedKeyOnce: {
    name: 'expandBinaryAssignment evaluates a side-effectful computed key once',
    input: `let calls = 0;
const arr = [1, 2, 3];
const idx = () => {
  calls++;
  return 1;
};
arr[idx()] += 100;`,
  },
  bigintSafe: {
    name: 'expandBinaryAssignment preserves BigInt arithmetic',
    input: `let n = 5n;
n += 2n;`,
  },
  leavesLogical: {
    name: 'expandBinaryAssignment leaves logical compound assignment alone',
    input: `let a = 0;
a ||= 5;`,
  },
})

function evalWith(src: string, observe: string): unknown {
  // oxlint-disable-next-line no-new-func
  return new Function(`${src}\nreturn (${observe});`)()
}

function expectEquivalent(input: string, observe: string): string {
  const out = run(input, expandBinaryAssignment)
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
  return out
}

test(cases.identArith.name, () => {
  const out = expectEquivalent(cases.identArith.input, 'x')
  expect(out).toContain('x = x + 2')
  expect(out).not.toContain('+=')
})

test(cases.allOps.name, () => {
  const observe = '[a, b, c, d, e, f, g, h, i, j, k]'
  const out = expectEquivalent(cases.allOps.input, observe)
  expect(out).not.toMatch(/[-*/%&|^]=[^=]/)
  expect(out).not.toContain('**=')
  expect(out).toContain('a = a - 3')
  expect(out).toContain('e = e ** 2')
})

test(cases.stringConcat.name, () => {
  const out = expectEquivalent(cases.stringConcat.input, 's')
  expect(out).not.toContain('+=')
  expect(evalWith(out, 's')).toBe('abc')
})

test(cases.memberReceiverOnce.name, () => {
  const out = expectEquivalent(cases.memberReceiverOnce.input, '[obj.x, calls]')
  expect(evalWith(out, '[obj.x, calls]')).toEqual([30, 1])
  expect(out).not.toContain('*=')
})

test(cases.computedKeyOnce.name, () => {
  const out = expectEquivalent(cases.computedKeyOnce.input, '[arr[1], calls]')
  expect(evalWith(out, '[arr[1], calls]')).toEqual([102, 1])
  expect(out).toMatch(/_idx\d* = idx\(\)/)
})

test(cases.bigintSafe.name, () => {
  const out = expectEquivalent(cases.bigintSafe.input, 'n')
  expect(evalWith(out, 'n')).toBe(7n)
  expect(out).toContain('n = n + 2n')
})

test(cases.leavesLogical.name, () => {
  const out = expectEquivalent(cases.leavesLogical.input, 'a')
  expect(out).toContain('||=')
})

function binaryPreserves(code: string): void {
  expect(trace(run(code, expandBinaryAssignment))).toEqual(trace(code))
}

test('expandBinaryAssignment does not duplicate a with-shadowed object read (A07-17)', () => {
  const src = `var a;
var holder = { n: 1 };
var o = { get a() { log('get'); return holder; } };
with (o) { a.n += 1; }
log(holder.n);`
  // `with` can make a duplicated object read invoke its getter twice.
  expect(run(src, expandBinaryAssignment)).toContain('a.n += 1')
  binaryPreserves(src)
})
