import generate from '@babel/generator'
import { parse } from '@babel/parser'
import { expect, test } from 'vitest'

import { obfuscate } from '../../src/obfuscator'
import { reorderFunctionDeclarations } from '../../src/transforms/reorder-function-declarations'
import { defineCases, run, trace } from '../helpers'

function expectEquivalent(input: string): string {
  const out = run(input, reorderFunctionDeclarations)
  expect(trace(out)).toEqual(trace(input))
  return out
}

defineCases('reorder-function-declarations', reorderFunctionDeclarations, {
  movesBelowUse: {
    name: 'reorderFunctionDeclarations moves a declaration below an earlier use',
    input: `function area(r) { return r * r; }\nlog(area(2));`,
  },
  nestedScope: {
    name: 'reorderFunctionDeclarations reorders inside a function body',
    input: `function outer() {\n  return inner();\n  function inner() { return 7; }\n}\nlog(outer());`,
  },
})

test('moves a hoisted declaration to the end of the scope', () => {
  const out = expectEquivalent(`function area(r) { return r * r; }\nlog(area(2));`)
  expect(out.indexOf('log(')).toBeLessThan(out.indexOf('function area'))
})

test('the moved function is still callable before its text through hoisting', () => {
  const out = run(`function area(r) { return r * r; }\nlog(area(2));`, reorderFunctionDeclarations)
  expect(out.indexOf('log(')).toBeLessThan(out.indexOf('function area'))
  expect(trace(out)).toEqual({ logs: [4], threw: null })
})

test('moves duplicate-named declarations in their original relative order', () => {
  const src = `function f() { return 1; }\nfunction f() { return 2; }\nlog(f());`
  const out = expectEquivalent(src)
  expect(out.indexOf('log(')).toBeLessThan(out.indexOf('function f'))
  expect(out.indexOf('return 1')).toBeLessThan(out.indexOf('return 2'))
})

test('leaves a sloppy-mode block function where it is', () => {
  const src = `if (true) {\n  function g() { return 5; }\n  log(g());\n}`
  const out = expectEquivalent(src)
  expect(out.indexOf('function g')).toBeLessThan(out.indexOf('log(g())'))
})

test('moves several declarations while preserving their relative order', () => {
  const src = `function a() { return 1; }\nfunction b() { return 2; }\nlog(a() + b());`
  const out = expectEquivalent(src)
  expect(out.indexOf('log(')).toBeLessThan(out.indexOf('function a'))
  expect(out.indexOf('function a')).toBeLessThan(out.indexOf('function b'))
})

test('moves a declaration inside a function body', () => {
  const src = `const outer = function () {
  function inner() { return 7; }
  log(inner());
};
outer();`
  const out = expectEquivalent(src)
  expect(out.indexOf('log(inner())')).toBeLessThan(out.indexOf('function inner'))
})

test('does not expose use strict as a Program directive', () => {
  const src = `function f() { return this; }
"use strict";
log(f() === globalThis);`
  const out = expectEquivalent(src)
  expect(out.indexOf('function f')).toBeLessThan(out.indexOf('"use strict"'))
  expect(trace(out)).toEqual({ logs: [true], threw: null })
})

test('keeps one declaration as a directive barrier and moves the rest', () => {
  const src = `function barrier() { return this; }
function moved() { return 2; }
"use strict";
log(barrier() === globalThis, moved());`
  const out = expectEquivalent(src)
  expect(out.indexOf('function barrier')).toBeLessThan(out.indexOf('"use strict"'))
  expect(out.indexOf('log(')).toBeLessThan(out.indexOf('function moved'))
  expect(trace(out)).toEqual({ logs: [[true, 2]], threw: null })
})

test('does not expose a custom directive', () => {
  const src = `function f() { return 1; }
"use client";
log(f());`
  const out = expectEquivalent(src)
  expect(out.indexOf('function f')).toBeLessThan(out.indexOf('"use client"'))
})

test('moves declarations after an existing directive prologue', () => {
  const src = `"use strict";
function f() { return 1; }
log(f());`
  const out = expectEquivalent(src)
  expect(out).toMatch(/^"use strict";/)
  expect(out.indexOf('log(f())')).toBeLessThan(out.indexOf('function f'))
})

test('moves async and generator declarations', () => {
  const src = `async function asyncValue() { return 1; }
function* values() { yield 2; }
log(typeof asyncValue, values().next().value);`
  const out = expectEquivalent(src)
  expect(out.indexOf('log(')).toBeLessThan(out.indexOf('async function asyncValue'))
  expect(out.indexOf('async function asyncValue')).toBeLessThan(out.indexOf('function* values'))
})

test('does not create a directive in a function with non-simple parameters', () => {
  const src = `const outer = function (value = 1) {
  function inner() {}
  "use strict";
  return value;
};
log(outer());`
  const out = expectEquivalent(src)
  expect(out.indexOf('function inner')).toBeLessThan(out.indexOf('"use strict"'))
  expect(trace(out)).toEqual({ logs: [1], threw: null })
})

test('remains parseable after parameter packing', () => {
  const src = `function outer() {
  var x = 1;
  function inner() {}
  "use strict";
  return x;
}
log(outer());`
  const out = obfuscate(src, {
    transforms: {
      packDeclarationsIntoParameters: true,
      reorderFunctionDeclarations: true,
    },
  })
  expect(() => parse(out)).not.toThrow()
  expect(trace(out)).toEqual(trace(src))
  expect(out.indexOf('function inner')).toBeLessThan(out.indexOf('"use strict"'))
})

test('moves strict switch-case declarations', () => {
  const src = `"use strict";
switch (1) {
  case 1:
    function f() { return 3; }
    log(f());
}`
  const out = expectEquivalent(src)
  expect(out.indexOf('log(f())')).toBeLessThan(out.indexOf('function f'))
})

test('moves declarations inside static initialization blocks', () => {
  const src = `class C {
  static {
    function f() { return 4; }
    log(f());
  }
}`
  const out = expectEquivalent(src)
  expect(out.indexOf('log(f())')).toBeLessThan(out.indexOf('function f'))
})

test('leaves an exported declaration in place', () => {
  const src = `export function keep() { return 1; }\nkeep();`
  expect(run(src, reorderFunctionDeclarations)).toEqual(run(src, () => {}))
})

test('moves an indirectly exported declaration', () => {
  const out = run(
    `function moved() { return 1; }
export { moved };`,
    reorderFunctionDeclarations,
  )
  expect(out.indexOf('export { moved }')).toBeLessThan(out.indexOf('function moved'))
})

test('reports no change after declarations reach the end', () => {
  const ast = parse(`function f() { return 1; }
log(f());`)
  expect(reorderFunctionDeclarations(ast)).toBe(true)
  const once = generate(ast).code
  expect(reorderFunctionDeclarations(ast)).toBe(false)
  expect(generate(ast).code).toBe(once)
})
