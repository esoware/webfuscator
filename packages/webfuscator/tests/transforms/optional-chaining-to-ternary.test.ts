import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { expect, test } from 'vitest'

import { obfuscate } from 'src/index'
import { optionalChainingToTernary } from 'src/transforms/optional-chaining-to-ternary'

import { defineCases, run, trace } from '../helpers'

const cases = defineCases('optional-chaining-to-ternary', optionalChainingToTernary, {
  boundIdentReceiver: {
    name: 'optionalChainingToTernary lowers ?. on a bound identifier without caching',
    input: `var obj;
var x = obj?.x;`,
  },
  sideEffectReceiver: {
    name: 'optionalChainingToTernary caches a side-effectful receiver',
    input: `var x = get()?.x;`,
  },
  optionalCallOnMember: {
    name: 'optionalChainingToTernary lowers obj?.m(arg) keeping the call',
    input: `var obj;
obj?.m(arg);`,
  },

  optionalCallOnIdent: {
    name: 'optionalChainingToTernary lowers fn?.() into a null-check ternary',
    input: `var fn;
fn?.();`,
  },
  optionalCallOnMemberCallee: {
    name: 'optionalChainingToTernary leaves an optional call on a member callee intact (a .call rewrite is observable)',
    input: `var obj;
obj?.m?.(arg);`,
  },

  twoLevelChain: {
    name: 'optionalChainingToTernary lowers a two-level optional chain into nested ternaries',
    input: `var a;
var x = a?.b?.c;`,
  },

  deleteOptionalMember: {
    name: 'optionalChainingToTernary preserves Reference deletion through delete obj?.x',
    input: `var obj = { x: 1 };
out.push(delete obj?.x);
out.push("x" in obj);`,
  },
  deleteOptionalNullReceiver: {
    name: 'optionalChainingToTernary short-circuits delete on a nullish receiver to true',
    input: `var obj = null;
out.push(delete obj?.x);`,
  },
  deleteDeepOptionalChain: {
    name: 'optionalChainingToTernary preserves Reference deletion through a multi-level chain',
    input: `var obj = { a: { b: 1 } };
out.push(delete obj?.a?.b);
out.push("b" in obj.a);`,
  },

  nonOptionalUntouched: {
    name: 'optionalChainingToTernary leaves a non-optional member expression alone',
    input: `var a;
var x = a.b;`,
  },
})

test(cases.boundIdentReceiver.name, () => {
  const out = run(cases.boundIdentReceiver.input, optionalChainingToTernary)
  expect(out).toContain('obj == null ? void 0 : obj.x')
  expect(out).not.toContain('?.')
})

test(cases.sideEffectReceiver.name, () => {
  const out = run(cases.sideEffectReceiver.input, optionalChainingToTernary)
  expect(out).toMatch(/\(_get\d* = get\(\)\) == null \? void 0 : _get\d*\.x/)
  expect(out).toMatch(/var _get\d*/)
  const harness = `
var calls = 0;
function get() { calls++; return { x: 42 }; }
${out}
out.push(x, calls);
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual([42, 1])
})

test(cases.optionalCallOnMember.name, () => {
  const out = run(cases.optionalCallOnMember.input, optionalChainingToTernary)
  expect(out).toContain('obj == null ? void 0 : obj.m(arg)')
})

test(cases.optionalCallOnIdent.name, () => {
  const out = run(cases.optionalCallOnIdent.input, optionalChainingToTernary)
  expect(out).toContain('fn == null ? void 0 : fn()')
})

test(cases.optionalCallOnMemberCallee.name, () => {
  const out = run(cases.optionalCallOnMemberCallee.input, optionalChainingToTernary)
  // Lowering would read the shadowable `.call` property.
  expect(out).toContain('obj?.m?.(arg)')
  expect(out).not.toContain('.call(')

  const src = `var obj = {
       m: function (a) {
         return [this === obj, a];
       }
     };
     out.push(obj?.m?.(99));`
  const arr: unknown[] = []
  new Function('out', run(src, optionalChainingToTernary))(arr)
  expect(arr[0]).toEqual([true, 99])
})

test(cases.twoLevelChain.name, () => {
  const out = run(cases.twoLevelChain.input, optionalChainingToTernary)
  expect(out).toContain('a == null ? void 0 :')
  expect(out).toMatch(/\(_a\$b\d* = a\.b\) == null \? void 0 : _a\$b\d*\.c/)
  expect(out).not.toContain('?.')
  const lowered = (val: string) =>
    run(`var a = ${val};\nvar x = a?.b?.c;`, optionalChainingToTernary)
  const runOnce = (val: string): unknown[] => {
    const arr: unknown[] = []
    new Function('out', `${lowered(val)}\nout.push(x);`)(arr)
    return arr
  }
  expect(runOnce('null')).toEqual([undefined])
  expect(runOnce('{ b: null }')).toEqual([undefined])
  expect(runOnce('{ b: { c: 7 } }')).toEqual([7])
})

test(cases.deleteOptionalMember.name, () => {
  const out = run(cases.deleteOptionalMember.input, optionalChainingToTernary)
  expect(out).not.toContain('?.')
  expect(out).toMatch(/:\s*delete\s+obj\.x/)
  expect(out).not.toMatch(/delete\s*\(/)

  const arr: unknown[] = []
  new Function('out', out)(arr)
  expect(arr).toEqual([true, false])
})

test(cases.deleteOptionalNullReceiver.name, () => {
  const out = run(cases.deleteOptionalNullReceiver.input, optionalChainingToTernary)
  const arr: unknown[] = []
  new Function('out', out)(arr)
  expect(arr).toEqual([true])
})

test(cases.deleteDeepOptionalChain.name, () => {
  const out = run(cases.deleteDeepOptionalChain.input, optionalChainingToTernary)
  expect(out).not.toContain('?.')
  expect(out).toMatch(/delete\s+[\w$]+\.b/)

  const arr: unknown[] = []
  new Function('out', out)(arr)
  expect(arr).toEqual([true, false])
})

test(cases.nonOptionalUntouched.name, () => {
  const out = run(cases.nonOptionalUntouched.input, optionalChainingToTernary)
  expect(out).toContain('var x = a.b')
  expect(out).not.toContain('==')
})

function optionalPreserves(code: string): void {
  expect(trace(run(code, optionalChainingToTernary))).toEqual(trace(code))
}

test('optionalChainingToTernary preserves this for a parenthesized callee (F8)', () => {
  optionalPreserves("let o = { m(){ return this && this.t }, t: 'T' }; log((o?.m)());")
})

test('optionalChainingToTernary preserves this for a super optional call (F9)', () => {
  optionalPreserves(
    'class B{ q(){ return this.v } } class A extends B{ constructor(){ super(); this.v = 42 } m(){ return super.q?.() } } log(new A().m());',
  )
})

test('optionalChainingToTernary short-circuits to void 0, not a shadowable undefined', () => {
  optionalPreserves('function f(undefined) { return { a: undefined?.b }; } log(f(7).a);')
})

test('optionalChainingToTernary does not route a call through a shadowable .call (F10)', () => {
  optionalPreserves(
    "function m(){ return this ? this.x : 'nothis' } m.call = function(){ return 'HIJACK' }; let o = {m, x:1}; log(o.m?.());",
  )
})

test('optionalChainingToTernary keeps the this of a tagged-template tag (A07-14)', () => {
  const src = `var o = { tag: function (s) { log(this === o); return 1; } };
log((o?.tag)\`x\`);`
  const out = run(src, optionalChainingToTernary)
  // Parentheses keep the optional tag valid and preserve `this`.
  expect(out).toContain('(o?.tag)`x`')
  expect(() => new Function('log', out)).not.toThrow()
  optionalPreserves(src)
})

test('optionalChainingToTernary leaves a with-shadowed read intact (A07-16)', () => {
  optionalPreserves(`var a;
var o = { get a() { log('get'); return { b: 1 }; } };
with (o) { log(a?.b); }`)
})

// A node reachable from two parents is visited twice. A later in-place rewrite
// such as `renameIdentifiers` then applies itself twice to the same node.
function nodesReachableTwice(code: string): string[] {
  const ast = parse(code, { sourceType: 'unambiguous' })
  optionalChainingToTernary(ast)
  const seen = new Set<t.Node>()
  const shared: string[] = []
  t.traverseFast(ast, (node) => {
    if (seen.has(node)) {
      shared.push(node.type)
      return
    }
    seen.add(node)
  })
  return shared
}

test('optionalChainingToTernary gives the null check its own receiver node', () => {
  expect(nodesReachableTwice(`var box;\nvar x = box?.flag;`)).toEqual([])
})

test('optionalChainingToTernary gives each short circuit of a chain its own node', () => {
  expect(nodesReachableTwice(`var a;\nvar x = a?.b?.c;`)).toEqual([])
})

// A static receiver is cloned, so its identifier appears twice after lowering
// (the null check and the member access). A later rename must reach both clones.
// The receiver has a distinctive source name that never appears as a property or
// string, so if any clone escaped the rename its old name would survive in the
// output. This does not depend on which name the renamer allocates.
test('optionalChainingToTernary lets a rename reach every clone of a static receiver', () => {
  const src = `function read(box) {
  var receiverBinding = box.data;
  if (receiverBinding?.flag === true) {
    return 'hit';
  }
  return 'miss';
}
log(read({ data: { flag: true } }));
log(read({ data: { flag: false } }));
log(read({ data: null }));`
  const out = obfuscate(src, {
    transforms: { optionalChainingToTernary: true, renameIdentifiers: true },
  })
  expect(out).not.toContain('?.')
  expect(out).not.toContain('receiverBinding')
  expect(trace(out)).toEqual(trace(src))
})
