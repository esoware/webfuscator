import { parse } from '@babel/parser'
import { expect, test } from 'vitest'

import { collapseSingleUseFunctions } from '../../src/transforms/collapse-single-use-functions'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('collapse-single-use-functions', collapseSingleUseFunctions, {
  valueReference: {
    name: 'moves a function to its only value reference',
    input: `function greet(name) {
  return 'hi ' + name;
}
register(greet);`,
  },
  singleCall: {
    name: 'moves a function called once into an IIFE',
    input: `function f() {
  return 41;
}
log(f() + 1);`,
  },
  hoistedForwardReference: {
    name: 'moves a function to a reference before its declaration',
    input: `var x = 1;
var g = f;
x = 2;
log(g());
function f() {
  return x;
}`,
  },
  twoIndependent: {
    name: 'moves two independent single-use functions',
    input: `function a() {
  return 1;
}
function b() {
  return 2;
}
log(a() + b());`,
  },
  generator: {
    name: 'moves a generator without changing iteration',
    input: `function* f() {
  yield 1;
  yield 2;
}
var it = f();
log(it.next().value + it.next().value);`,
  },

  multipleReferences: {
    name: 'leaves a function with multiple references',
    input: `function f() {
  return 1;
}
log(f());
log(f());`,
  },
  reassigned: {
    name: 'leaves a reassigned function binding',
    input: `function f() {
  return 1;
}
f = function () {
  return 2;
};
log(f());`,
  },
  recursive: {
    name: 'leaves a recursive function',
    input: `function fact(n) {
  return n <= 1 ? 1 : n * fact(n - 1);
}
log(fact(5));`,
  },
  loopReference: {
    name: 'leaves a reference inside a loop body',
    input: `var arr = [];
function f() {
  return 1;
}
for (var i = 0; i < 2; i++) {
  arr.push(f);
}
log(arr[0] === arr[1]);`,
  },
  nestedFunctionReference: {
    name: 'leaves a reference inside a nested function',
    input: `function f() {
  return 1;
}
var g = () => f;
log(g() === g());`,
  },
  classFieldReference: {
    name: 'leaves a reference inside a class instance field',
    input: `function f() {
  return 1;
}
class C {
  m = f;
}
log(new C().m === new C().m);`,
  },
  exportedDeclaration: {
    name: 'leaves an exported function declaration',
    input: `export function f() {
  return 1;
}
log(f());`,
  },
  exportSpecifierReference: {
    name: 'leaves a function whose only reference is an export specifier',
    input: `function f() {
  return 1;
}
log('x');
export { f };`,
  },
  shorthandReference: {
    name: 'leaves a shorthand property reference',
    input: `function f() {
  return 1;
}
var o = { f };
log(o.f());`,
  },
  deleteReference: {
    name: 'leaves a delete operand reference',
    input: `function f() {
  return 1;
}
log(delete f);`,
  },
})

function relocatePreserves(code: string): string {
  const out = run(code, collapseSingleUseFunctions)
  expect(trace(out)).toEqual(trace(code))
  return out
}

test(cases.valueReference.name, () => {
  const out = run(cases.valueReference.input, collapseSingleUseFunctions)
  expect(out).not.toMatch(/function greet/)
  expect(out).toMatch(/register\(function/)
  const calls: unknown[] = []
  new Function('register', `${out}`)((g: (n: string) => string) => calls.push(g('a')))
  expect(calls).toEqual(['hi a'])
})

test(cases.singleCall.name, () => {
  const out = run(cases.singleCall.input, collapseSingleUseFunctions)
  expect(out).not.toMatch(/function f\b/)
  const calls: unknown[] = []
  new Function('log', out)((v: unknown) => calls.push(v))
  expect(calls).toEqual([42])
})

test(cases.hoistedForwardReference.name, () => {
  const out = run(cases.hoistedForwardReference.input, collapseSingleUseFunctions)
  expect(out).not.toMatch(/function f\b/)
  const calls: unknown[] = []
  new Function('log', out)((v: unknown) => calls.push(v))
  expect(calls).toEqual([2])
})

test(cases.twoIndependent.name, () => {
  const out = run(cases.twoIndependent.input, collapseSingleUseFunctions)
  expect(out).not.toMatch(/function a\b/)
  expect(out).not.toMatch(/function b\b/)
  const calls: unknown[] = []
  new Function('log', out)((v: unknown) => calls.push(v))
  expect(calls).toEqual([3])
})

test(cases.generator.name, () => {
  const out = run(cases.generator.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function\*/)
  const calls: unknown[] = []
  new Function('log', out)((v: unknown) => calls.push(v))
  expect(calls).toEqual([3])
})

test('moves an async function without changing its resolved value', async () => {
  const out = run(`async function f() { return 41; } deliver(f);`, collapseSingleUseFunctions)
  expect(out).toMatch(/deliver\(async function/)
  let received: unknown
  new Function('deliver', out)((g: () => Promise<number>) => {
    received = g()
  })
  await expect(received).resolves.toBe(41)
})

test('relocated `this` binds to the call-site receiver', () => {
  relocatePreserves(
    `function f() { return this.v; } var o = { v: 7, m: null }; o.m = f; log(o.m());`,
  )
})

test('relocated body keeps its own `arguments`', () => {
  relocatePreserves(`function f() { return arguments.length; } log(f(1, 2, 3));`)
})

test('relocated function works as a constructor', () => {
  relocatePreserves(`function F() { this.x = 1; } var o = new F(); log(o.x);`)
})

test('relocation preserves default and destructured parameters', () => {
  relocatePreserves(`function f(a, { b } = { b: 2 }) { return a + b; } log(f(1));`)
})

test('does not let a block binding capture a free read', () => {
  const out = relocatePreserves(
    `var x = 'outer'; function f() { return x; } { let x = 'inner'; log(f()); }`,
  )
  expect(out).toMatch(/function f\b/)
})

test('does not let a catch parameter capture a free read', () => {
  const out = relocatePreserves(
    `var e = 'outer'; function f() { return e; } try { throw 'inner'; } catch (e) { log(f()); }`,
  )
  expect(out).toMatch(/function f\b/)
})

test('does not capture a previously unbound name', () => {
  const out = relocatePreserves(
    `function f() { return typeof missing; } { let missing = 1; log(f()); }`,
  )
  expect(out).toMatch(/function f\b/)
})

test('does not redirect a free write to a shadowing binding', () => {
  const out = relocatePreserves(
    `var x = 'outer'; function f() { x = 'changed'; } { let x = 'inner'; f(); log(x); } log(x);`,
  )
  expect(out).toMatch(/function f\b/)
})

test('checks free bindings in parameter defaults', () => {
  const out = relocatePreserves(
    `var x = 'outer'; function f(a = x) { return a; } { let x = 'inner'; log(f()); }`,
  )
  expect(out).toMatch(/function f\b/)
})

test('checks free bindings used by nested closures', () => {
  const out = relocatePreserves(
    `var x = 'outer'; function f() { return function () { return x; }; } { let x = 'inner'; log(f()()); }`,
  )
  expect(out).toMatch(/function f\b/)
})

test('relocation preserves the TDZ of a later `let` binding', () => {
  relocatePreserves(`var r = f(); let y = 5; log(typeof y, r); function f() { return y; }`)
})

test('relocation preserves behavior when the reference branch does not run', () => {
  relocatePreserves(
    `var c = false; if (c) { log(f()); } else { log('skip'); } function f() { return 9; }`,
  )
})

test(cases.multipleReferences.name, () => {
  const out = run(cases.multipleReferences.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function f\b/)
})

test(cases.reassigned.name, () => {
  const out = run(cases.reassigned.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function f\b/)
})

test(cases.recursive.name, () => {
  const out = run(cases.recursive.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function fact/)
})

test(cases.loopReference.name, () => {
  const out = run(cases.loopReference.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function f\b/)
  relocatePreserves(cases.loopReference.input)
})

test(cases.nestedFunctionReference.name, () => {
  const out = run(cases.nestedFunctionReference.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function f\b/)
  relocatePreserves(cases.nestedFunctionReference.input)
})

test(cases.classFieldReference.name, () => {
  const out = run(cases.classFieldReference.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function f\b/)
  relocatePreserves(cases.classFieldReference.input)
})

test('relocation keeps function identity per activation', () => {
  relocatePreserves(
    `var store = []; function outer() { function f() { return 1; } store.push(f); } outer(); outer(); log(store[0] === store[1]);`,
  )
})

test(cases.exportedDeclaration.name, () => {
  const out = run(cases.exportedDeclaration.input, collapseSingleUseFunctions)
  expect(out).toMatch(/export function f/)
})

test(cases.exportSpecifierReference.name, () => {
  const out = run(cases.exportSpecifierReference.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function f\b/)
  expect(out).toMatch(/export \{\s*f\s*\}/)
})

test(cases.shorthandReference.name, () => {
  const out = run(cases.shorthandReference.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function f\b/)
})

test(cases.deleteReference.name, () => {
  const out = run(cases.deleteReference.input, collapseSingleUseFunctions)
  expect(out).toMatch(/function f\b/)
})

test('relocation into a catch block preserves behavior', () => {
  const out = relocatePreserves(
    `function f() { return 1; } try { throw 0; } catch (e) { log(f()); }`,
  )
  expect(out).not.toMatch(/function f\b/)
})

test('strict block-scoped function relocates within its block', () => {
  relocatePreserves(`'use strict'; { function f() { return 7; } log(f()); }`)
})

test('does not remove a Program directive barrier', () => {
  const code = `function f(a) { a = 2; return arguments[0]; }
"use strict";
log(f(1));`
  const out = relocatePreserves(code)
  expect(out.indexOf('function f')).toBeLessThan(out.indexOf('"use strict"'))
})

test('does not create an illegal directive in a function with non-simple parameters', () => {
  const code = `function outer(value = 1) {
  function f() { return value; }
  "use strict";
  return f();
}
log(outer());
log(outer());`
  const out = relocatePreserves(code)
  expect(() => parse(out)).not.toThrow()
  expect(out.indexOf('function f')).toBeLessThan(out.indexOf('"use strict"'))
})

test('does not expose a directive through a labeled declaration', () => {
  const code = `function outer(value = 1) {
  label: function f() { return value; }
  "use strict";
  return f();
}
log(outer());
log(outer());`
  const out = relocatePreserves(code)
  expect(() => parse(out)).not.toThrow()
  expect(out).toMatch(/label:\s*function f/)
})

test('collapses deeply nested declarations in one pass', () => {
  const depth = 20
  let nested = `function f${depth - 1}() { return 1; }`
  for (let index = depth - 2; index >= 0; index--) {
    nested = `function f${index}() { ${nested} return f${index + 1}(); }`
  }
  const code = `${nested} log(f0());`
  const out = relocatePreserves(code)
  expect(out).not.toMatch(/function f\d+\b/)

  const ast = parse(code, { sourceType: 'unambiguous' })
  expect(collapseSingleUseFunctions(ast)).toBe(true)
  expect(collapseSingleUseFunctions(ast)).toBe(false)
})

test('collapseSingleUseFunctions returns false on a stable input', () => {
  const ast = parse(`function f() { return 1; } log(f()); log(f());`, { sourceType: 'unambiguous' })
  expect(collapseSingleUseFunctions(ast)).toBe(false)
})

test('collapseSingleUseFunctions returns true then false across passes', () => {
  const ast = parse(`function f() { return 1; } log(f());`, { sourceType: 'unambiguous' })
  expect(collapseSingleUseFunctions(ast)).toBe(true)
  expect(collapseSingleUseFunctions(ast)).toBe(false)
})
