import { expect, test } from 'vitest'

import { logicalToTernary } from 'src/transforms/logical-to-ternary'

import { defineCases, run, trace } from '../helpers'

const cases = defineCases('logical-to-ternary', logicalToTernary, {
  andBoundIdent: {
    name: 'logicalToTernary rewrites && on a bound identifier without caching',
    input: `var a;
var x = a && b;`,
  },
  orBoundIdent: {
    name: 'logicalToTernary rewrites || on a bound identifier without caching',
    input: `var a;
var x = a || b;`,
  },

  andSideEffect: {
    name: 'logicalToTernary caches a side-effectful left operand for &&',
    input: `function get() { calls++; return v; }
var calls = 0, v = 1;
var x = get() && use();
function use() { return 2; }`,
  },
  orSideEffect: {
    name: 'logicalToTernary caches a side-effectful left operand for ||',
    input: `function get() { calls++; return v; }
var calls = 0, v = 0;
var x = get() || fallback;`,
  },

  andMember: {
    name: 'logicalToTernary caches a member-expression left for && and evaluates the member access exactly once',
    input: `var calls = 0;
function readObj() { calls++; return { prop: 1 }; }
var x = readObj().prop && readObj().prop * 2;`,
  },

  nullishBoundIdent: {
    name: 'logicalToTernary lowers ?? on a bound identifier with the != null test',
    input: `var a;
var x = a ?? b;`,
  },
  nullishSideEffect: {
    name: 'logicalToTernary caches a side-effectful left operand for ??',
    input: `function get() { calls++; return v; }
var calls = 0, v = null;
var x = get() ?? fallback;`,
  },

  andLiteralLeft: {
    name: 'logicalToTernary clones a literal left without caching',
    input: `var x = 1 && b;`,
  },
  andPureBinaryLeft: {
    name: 'logicalToTernary clones a pure binary left (null === u) without caching',
    input: `var u;
var x = (null === u) && b;`,
  },
  andPureUnaryLeft: {
    name: 'logicalToTernary clones a pure unary left (!a) without caching',
    input: `var a;
var x = !a && b;`,
  },

  orAssignStatement: {
    name: 'logicalToTernary lowers a bare-ident || assignment statement into assign-then-guard',
    input: `var a = 0;
var b = 7;
var x;
x = a || b;`,
  },
  andAssignStatement: {
    name: 'logicalToTernary lowers a bare-ident && assignment statement into assign-then-guard',
    input: `var a = 3;
var b = 7;
var x;
x = a && b;`,
  },
})

test(cases.andBoundIdent.name, () => {
  const out = run(cases.andBoundIdent.input, logicalToTernary)
  expect(out).not.toMatch(/&&|\?[^?]/)
  expect(out).toMatch(/var x = a;\s*if \(x\)\s*{\s*x = b;/)
})

test(cases.orBoundIdent.name, () => {
  const out = run(cases.orBoundIdent.input, logicalToTernary)
  expect(out).not.toMatch(/\|\||\?[^?]/)
  expect(out).toMatch(/var x = a;\s*if \(!x\)\s*{\s*x = b;/)
})

test(cases.andSideEffect.name, () => {
  const out = run(cases.andSideEffect.input, logicalToTernary)
  expect(out).not.toContain('&&')
  const ctx = new Function(`${out}\nreturn { x: x, calls: calls };`)() as {
    x: unknown
    calls: number
  }
  expect(ctx).toEqual({ x: 2, calls: 1 })
})

test(cases.orSideEffect.name, () => {
  const out = run(cases.orSideEffect.input, logicalToTernary)
  expect(out).not.toContain('||')
  const ctx = new Function(`var fallback = 'fb';\n${out}\nreturn { x: x, calls: calls };`)() as {
    x: unknown
    calls: number
  }
  expect(ctx).toEqual({ x: 'fb', calls: 1 })
})

test(cases.andMember.name, () => {
  const out = run(cases.andMember.input, logicalToTernary)
  const ctx = new Function(`${out}\nreturn { x: x, calls: calls };`)() as {
    x: unknown
    calls: number
  }
  // The consequent must reuse each explicit `readObj()` call.
  expect(ctx).toEqual({ x: 2, calls: 2 })
})

test(cases.nullishBoundIdent.name, () => {
  const out = run(cases.nullishBoundIdent.input, logicalToTernary)
  expect(out).not.toContain('??')
  expect(out).not.toMatch(/\?[^?]/)
  expect(out).toMatch(/var x = a;\s*if \(x == null\)\s*{\s*x = b;/)
})

test(cases.nullishSideEffect.name, () => {
  const out = run(cases.nullishSideEffect.input, logicalToTernary)
  expect(out).not.toContain('??')
  const ctx = new Function(`var fallback = 'fb';\n${out}\nreturn { x: x, calls: calls };`)() as {
    x: unknown
    calls: number
  }
  expect(ctx).toEqual({ x: 'fb', calls: 1 })
})

test(cases.andLiteralLeft.name, () => {
  const out = run(cases.andLiteralLeft.input, logicalToTernary)
  expect(out).not.toMatch(/var _\w+/)
  expect(out).not.toMatch(/&&|\?[^?]/)
  expect(out).toMatch(/var x = 1;\s*if \(x\)\s*{\s*x = b;/)
})

test(cases.andPureBinaryLeft.name, () => {
  const out = run(cases.andPureBinaryLeft.input, logicalToTernary)
  expect(out).not.toMatch(/var _\w+/)
  expect(out).not.toMatch(/&&|\?[^?]/)
  expect(out).toMatch(/var x = null === u;\s*if \(x\)\s*{\s*x = b;/)
})

test(cases.andPureUnaryLeft.name, () => {
  const out = run(cases.andPureUnaryLeft.input, logicalToTernary)
  expect(out).not.toMatch(/var _\w+/)
  expect(out).not.toMatch(/&&|\?[^?]/)
  expect(out).toMatch(/var x = !a;\s*if \(x\)\s*{\s*x = b;/)
})

test(cases.orAssignStatement.name, () => {
  const out = run(cases.orAssignStatement.input, logicalToTernary)
  expect(out).not.toMatch(/\|\||\?[^?]/)
  expect(out).toMatch(/x = a;\s*if \(!x\)\s*{\s*x = b;/)
  expect(new Function(`${out}\nreturn x;`)()).toBe(7)
})

test(cases.andAssignStatement.name, () => {
  const out = run(cases.andAssignStatement.input, logicalToTernary)
  expect(out).not.toMatch(/&&|\?[^?]/)
  expect(out).toMatch(/x = a;\s*if \(x\)\s*{\s*x = b;/)
  expect(new Function(`${out}\nreturn x;`)()).toBe(7)
})

function logicalPreserves(code: string): void {
  expect(trace(run(code, logicalToTernary))).toEqual(trace(code))
}

test('logicalToTernary does not break a const write (F6)', () => {
  const out = run('const x = 0 || 7; log(x);', logicalToTernary)
  expect(() => new Function('log', out)).not.toThrow()
  logicalPreserves('const x = 0 || 7; log(x);')
})

test('logicalToTernary does not clobber a target the right operand reads (F7)', () => {
  logicalPreserves('let x = 5; x = 0 || x; log(x);')
  logicalPreserves('let x = 5; function g(){return x} x = 0 || g(); log(x);')
})

test('logicalToTernary caches a coercing left operand instead of duplicating it (A07-10)', () => {
  const src = `var x = { valueOf: function () { log('valueOf'); return 1; } };
log((x - 0) || 'fb');`
  const out = run(src, logicalToTernary)
  // The coercing subtraction must not be duplicated across test and value.
  expect(out).not.toMatch(/x - 0[\s\S]*x - 0/)
  logicalPreserves(src)
  logicalPreserves(`var x = { valueOf: function () { log('valueOf'); return 1; } };
log((-x) || 'fb');`)
})

test('logicalToTernary declarator does not let the right operand observe the target (A07-11)', () => {
  logicalPreserves(`function probe() { log(x); return 9; }
var x = 0 || probe();
log(x);`)
  logicalPreserves(`function probe() { try { log(typeof y); } catch (e) { log('TDZ'); } return 1; }
let y = 0 || probe();
log(y);`)
})

test('logicalToTernary does not add a read or second write to an accessor target (A07-13)', () => {
  const src = `Object.defineProperty(globalThis, 'gx7b', { configurable: true, get: function () { log('get'); return 0; }, set: function (v) { log('set', v); } });
gx7b = 5 || 7;
log('end');`
  try {
    logicalPreserves(src)
  } finally {
    delete (globalThis as Record<string, unknown>)['gx7b']
  }
})

test('logicalToTernary leaves a with-shadowed read intact (A07-15)', () => {
  logicalPreserves(`var a;
var o = { get a() { log('get'); return { b: 1 }; } };
with (o) { log(a || 'fb'); }`)
})

test('logicalToTernary does not publish the left operand across a suspension (A07-16)', () => {
  // Suspension on the right could expose an early write to the target.
  logicalPreserves(`var peek;
async function start(p) {
  peek = function () { return x; };
  var x = 0 || (await p);
  return x;
}
start(new Promise(function () {}));
log(peek());`)
  logicalPreserves(`var peek;
function* gen() {
  peek = function () { return x; };
  var x = 0 || (yield 1);
  return x;
}
var it = gen();
it.next();
log(peek());
log(it.next(7).value);`)
})
