import generate from '@babel/generator'
import { parse } from '@babel/parser'
import { expect, test } from 'vitest'

import { hoistVariables } from '../../src/transforms/hoist-variables'
import { defineCases, run, trace } from '../helpers'

function expectEquivalent(input: string): string {
  const out = run(input, hoistVariables)
  expect(trace(out)).toEqual(trace(input))
  return out
}

defineCases('hoist-variables', hoistVariables, {
  acrossBlocks: {
    name: 'hoistVariables raises vars from nested blocks to the function top',
    input: `function f(c) {\n  var x = 1;\n  if (c) {\n    var y = 2;\n  }\n  return x + (c ? y : 0);\n}\nlog(f(true), f(false));`,
  },
  forLoop: {
    name: 'hoistVariables lifts a for-head var and rewrites the head',
    input: `function sum(n) {\n  var total = 0;\n  for (var i = 0; i < n; i++) {\n    total += i;\n  }\n  return total;\n}\nlog(sum(4));`,
  },
})

test('splits an initializer into a top declaration and an in-place assignment', () => {
  const out = expectEquivalent(`function f() {\n  var x = 1;\n  return x;\n}\nlog(f());`)
  expect(out).toContain('var x;')
  expect(out).toContain('x = 1;')
})

test('merges every eligible var in a function scope into one declaration', () => {
  const out = expectEquivalent(
    `function f() {\n  var a = 1;\n  var b = 2;\n  var c = 3;\n  return a + b + c;\n}\nlog(f());`,
  )
  expect(out).toMatch(/var a,\s*b,\s*c;/)
})

test('preserves initializer side-effect order', () => {
  const src = `function f() {\n  var order = [];\n  var a = (order.push(1), 1);\n  var b = (order.push(2), 2);\n  return order.join(",") + ":" + (a + b);\n}\nlog(f());`
  expect(trace(run(src, hoistVariables))).toEqual({ logs: ['1,2:3'], threw: null })
})

test('a hoisted bare declaration does not overwrite a same-named function', () => {
  const src = `function f() {\n  log(typeof g);\n  var g = 5;\n  log(g);\n  function g() {}\n}\nf();`
  expectEquivalent(src)
})

test('rewrites a for-in head', () => {
  const out = expectEquivalent(
    `function keys(o) {\n  var out = [];\n  for (var k in o) {\n    out.push(k);\n  }\n  return out.join(",");\n}\nlog(keys({ a: 1, b: 2 }));`,
  )
  expect(out).toContain('for (k in o)')
})

test('preserves a sloppy for-in initializer before the right-hand side', () => {
  const src = `function f() {
  var order = [];
  for (var x = (order.push("init"), 1) in (order.push("right"), {})) {}
  return order.join(",") + ":" + typeof x + ":" + x;
}
log(f());`
  const out = expectEquivalent(src)
  expect(out).toContain('for (x in x = (order.push("init"), 1),')
  expect(trace(out)).toEqual({ logs: ['init,right:number:1'], threw: null })
})

test('rewrites a for-of head', () => {
  const out = expectEquivalent(
    `function each(xs) {\n  var out = [];\n  for (var v of xs) {\n    out.push(v);\n  }\n  return out.join(",");\n}\nlog(each([1, 2, 3]));`,
  )
  expect(out).toContain('for (v of xs)')
})

test('keeps a nested function var inside the nested function', () => {
  const src = `function outer() {\n  var a = 1;\n  function inner() {\n    var b = 2;\n    return b;\n  }\n  return a + inner();\n}\nlog(outer());`
  const out = expectEquivalent(src)
  const innerStart = out.indexOf('function inner')
  expect(out.indexOf('var b;')).toBeGreaterThan(innerStart)
})

test('hoists vars in methods and derived constructors', () => {
  const src = `class Base {
  constructor(value) { this.value = value; }
}
class Derived extends Base {
  constructor() {
    var value = 3;
    super(value);
  }
  method() {
    var extra = 4;
    return this.value + extra;
  }
}
log(new Derived().method());`
  const out = expectEquivalent(src)
  expect(out).toContain('constructor() {\n    var value;')
  expect(out).toContain('method() {\n    var extra;')
})

test('preserves a catch parameter that shares its name with var', () => {
  const src = `function f() {
  try {
    throw 1;
  } catch (error) {
    var error = 2;
    log(error);
  }
  return typeof error;
}
log(f());`
  expectEquivalent(src)
})

test('hoists a destructuring for-of target', () => {
  const src = `function f() {
  var out = [];
  for (var [a, b] of [[1, 2], [3, 4]]) {
    out.push(a + b);
  }
  return out.join(",");
}
log(f());`
  const out = expectEquivalent(src)
  expect(out).toContain('for ([a, b] of')
})

test('hoists a destructuring var, keeping the assignment in place', () => {
  const src = `function f(o) {\n  var { a, b } = o;\n  return a + b;\n}\nlog(f({ a: 2, b: 3 }));`
  const out = expectEquivalent(src)
  expect(out).toMatch(/var a,\s*b;/)
})

test('does not emit an empty declaration for a zero-binding object pattern', () => {
  const src = `function f(o) {
  var {} = o;
  return 1;
}
log(f({}));`
  const out = expectEquivalent(src)
  expect(out).not.toMatch(/\bvar\s*;/)
})

test('preserves zero-binding object pattern evaluation', () => {
  const src = `function value() {
  log("evaluated");
  return {};
}
function f() {
  var {} = value();
}
f();`
  const out = expectEquivalent(src)
  expect(out).not.toMatch(/\bvar\s*;/)
})

test('does not emit an empty declaration for a zero-binding for-of pattern', () => {
  const src = `function f(xs) {
  for (var [] of xs) {}
  return 1;
}
log(f([[]]));`
  const out = expectEquivalent(src)
  expect(out).not.toMatch(/\bvar\s*;/)
})

test('does not emit an empty declaration for a zero-binding for-in pattern', () => {
  const src = `function f(o) {
  var count = 0;
  for (var {} in o) count++;
  return count;
}
log(f({ a: 1, b: 2 }));`
  const out = expectEquivalent(src)
  expect(out).not.toMatch(/\bvar\s*;/)
})

test('does not emit an empty declaration in a static block', () => {
  const src = `class C {
  static {
    var {} = {};
    log("ok");
  }
}`
  const out = expectEquivalent(src)
  expect(out).not.toMatch(/\bvar\s*;/)
})

test('drops a bare declaration into the merged top declaration', () => {
  const out = expectEquivalent(`function f() {\n  var x;\n  x = 5;\n  return x;\n}\nlog(f());`)
  expect(out).toContain('var x;')
})

test('leaves a var inside `with` untouched', () => {
  const src = `function f(o) {\n  with (o) {\n    var x = 1;\n  }\n  return x;\n}\nlog(f({}));`
  expect(run(src, hoistVariables)).toEqual(run(src, () => {}))
})

test('eval does not block variable hoisting', () => {
  const src = `function f() {\n  var x = 1;\n  return eval("x");\n}\nlog(f());`
  const out = run(src, hoistVariables)
  expect(out).toContain('var x;')
  expect(out).toContain('x = 1;')
})

test('an outer with statement does not block a nested function scope', () => {
  const src = `function outer(o) {
  with (o) {
    return function inner() {
      var x = 1;
      return x;
    };
  }
}
log(outer({})());`
  const out = expectEquivalent(src)
  expect(out).toContain('function inner() {\n      var x;\n      x = 1;')
})

test('leaves an exported var untouched', () => {
  const src = `export var x = 1;\nx;`
  expect(run(src, hoistVariables)).toEqual(run(src, () => {}))
})

test('hoists bare top-level script vars', () => {
  const src = `if (false) {
  var a;
}
var b;
log(typeof a, typeof b);`
  const out = expectEquivalent(src)
  expect(out).toMatch(/^var a,\s*b;/)
})

test('hoists initialized top-level script vars', () => {
  const src = `var x = 2;
log(x);`
  const out = expectEquivalent(src)
  expect(out).toMatch(/^var x;/)
  expect(out).toContain('x = 2;')
})

test('hoists initialized top-level module vars', () => {
  const out = run(
    `export {};
var a = 1;
var b = 2;`,
    hoistVariables,
  )
  expect(out).toMatch(/^var a,\s*b;/)
  expect(out).toContain('a = 1;')
  expect(out).toContain('b = 2;')
})

test('hoists vars into their static initialization block', () => {
  const src = `class C {
  static {
    var x = 1;
    log(x);
  }
}
log(typeof x);`
  const out = expectEquivalent(src)
  expect(out).toContain('static {\n    var x;\n    x = 1;')
  expect(out).not.toMatch(/^var x;/)
})

test('rewrites several initializers in a singleton statement position', () => {
  const src = `function f(c) {
  if (c) var a = 1, b = 2;
  return a + b;
}
log(f(true));`
  const out = expectEquivalent(src)
  expect(out).toContain('if (c) {\n    a = 1;\n    b = 2;\n  }')
})

test('reports no change after variables reach one leading bare declaration', () => {
  const ast = parse(`function f() {
  var x = 1;
  return x;
}`)
  expect(hoistVariables(ast)).toBe(true)
  const once = generate(ast).code
  expect(hoistVariables(ast)).toBe(false)
  expect(generate(ast).code).toBe(once)
})
