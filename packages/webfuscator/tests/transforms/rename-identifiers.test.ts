import { parse } from '@babel/parser'
import type { File } from '@babel/types'
import { expect, test } from 'vitest'

import { renameIdentifiers } from '../../src/transforms/rename-identifiers'
import { defineCases, run, trace } from '../helpers'

const renameMangled = (ast: File): void => {
  renameIdentifiers(ast, { seed: 0, stringGeneratorMode: 'mangled' })
}
const renameZeroWidth = (ast: File): void => {
  renameIdentifiers(ast, { seed: 0, stringGeneratorMode: 'zeroWidth' })
}

const cases = defineCases('rename-identifiers', renameMangled, {
  siblingParams: {
    name: 'renames sibling parameters without collision (regression: a->b shadowing b)',
    input: `function add(a, b) { return a + b; }
log(add(1, 2));`,
  },
  derivedClass: {
    name: 'renames a derived class without breaking extends or new',
    input: `class Base { constructor(x) { this.x = x; } }
class Derived extends Base { constructor(x) { super(x * 2); } }
log(new Derived(7).x);`,
  },
  closure: {
    name: 'renames closures while keeping inner refs pointing at outer binding',
    input: `function outer() {
  var x = 10;
  return function inner() { return x + 1; };
}
log(outer()());`,
  },
  labels: {
    name: 'renames labels and rewrites every break/continue ref to that label',
    input: `outer: for (var i = 0; i < 3; i++) {
  for (var j = 0; j < 3; j++) {
    if (j === 1) continue outer;
    log(i, j);
  }
}`,
  },
  freeIdentifiers: {
    name: 'does not touch free identifiers (globals, harness functions)',
    input: `function f(x) { return Math.abs(x) + 1; }
log(f(-5));`,
  },
  namedFunctionExpression: {
    name: 'handles named function expressions whose self-binding is in the function scope',
    input: `var f = function inner(n) {
  return n <= 1 ? 1 : n * inner(n - 1);
};
log(f(5));`,
  },
  catchClause: {
    name: 'handles catch-clause bindings without renaming the surrounding scope',
    input: `function f() {
  try { throw "err"; } catch (e) { return e; }
}
log(f());`,
  },
  destructuringPattern: {
    name: 'renames destructuring-pattern bindings while leaving property keys alone',
    input: `function f(arg) {
  var { a, b: c } = arg;
  return a + c;
}
log(f({ a: 1, b: 2 }));`,
  },
})

const zeroWidthCases = defineCases('rename-identifiers-zero-width', renameZeroWidth, {
  basic: {
    name: 'zeroWidth mode produces a runnable program',
    input: `function add(a, b) { return a + b; } log(add(2, 3));`,
  },
})

function evalScript(code: string, harness: Record<string, unknown>): unknown[] {
  const calls: unknown[] = []
  const fns: Record<string, unknown> = { ...harness, log: (v: unknown) => calls.push(v) }
  const keys = Object.keys(fns)
  new Function(...keys, code)(...keys.map((k) => fns[k]))
  return calls
}

test(cases.siblingParams.name, () => {
  const out = run(cases.siblingParams.input, renameMangled)
  expect(out).not.toContain(' a + b')
  expect(out).not.toContain(' a + a')
  expect(out).not.toContain(' b + b')
  expect(evalScript(out, {})).toEqual([3])
})

test(cases.derivedClass.name, () => {
  const out = run(cases.derivedClass.input, renameMangled)
  expect(out).not.toContain('Base')
  expect(out).not.toContain('Derived')
  expect(evalScript(out, {})).toEqual([14])
})

test(cases.closure.name, () => {
  const out = run(cases.closure.input, renameMangled)
  expect(evalScript(out, {})).toEqual([11])
})

test(cases.labels.name, () => {
  const out = run(cases.labels.input, renameMangled)
  expect(out).not.toContain('outer:')
  expect(out).not.toContain('continue outer')
  // Each outer iteration runs only the first inner iteration.
  expect(evalScript(out, {})).toEqual([0, 1, 2])
})

test(cases.freeIdentifiers.name, () => {
  const out = run(cases.freeIdentifiers.input, renameMangled)
  expect(out).toContain('Math')
  expect(out).toContain('Math.abs')
  expect(evalScript(out, {})).toEqual([6])
})

test(cases.namedFunctionExpression.name, () => {
  const out = run(cases.namedFunctionExpression.input, renameMangled)
  expect(evalScript(out, {})).toEqual([120])
})

test(cases.catchClause.name, () => {
  const out = run(cases.catchClause.input, renameMangled)
  expect(evalScript(out, {})).toEqual(['err'])
})

test(cases.destructuringPattern.name, () => {
  const out = run(cases.destructuringPattern.input, renameMangled)
  expect(out).toMatch(/a:/)
  expect(out).toMatch(/b:/)
  expect(evalScript(out, {})).toEqual([3])
})

test(zeroWidthCases.basic.name, () => {
  const out = run(zeroWidthCases.basic.input, renameZeroWidth)
  expect(evalScript(out, {})).toEqual([5])
})

test('same seed produces same output', () => {
  const src = `function helper(a, b) { return a * b; } log(helper(3, 4));`
  const seed7 = (ast: File): void => {
    renameIdentifiers(ast, { seed: 7, stringGeneratorMode: 'mangled' })
  }
  expect(run(src, seed7)).toBe(run(src, seed7))
})

test('different seeds produce different outputs', () => {
  const src = `function helper(a, b) { return a * b; } log(helper(3, 4));`
  const seed0 = (ast: File): void => {
    renameIdentifiers(ast, { seed: 0, stringGeneratorMode: 'mangled' })
  }
  const seed1 = (ast: File): void => {
    renameIdentifiers(ast, { seed: 1, stringGeneratorMode: 'mangled' })
  }
  expect(run(src, seed0)).not.toBe(run(src, seed1))
})

test('returns false on a program with no bindings to rename', () => {
  const ast = parse(`log(1 + 2);`, { sourceType: 'unambiguous' })
  expect(renameIdentifiers(ast, { seed: 0, stringGeneratorMode: 'mangled' })).toBe(false)
})

function runBothWith(
  code: string,
  mode: 'mangled' | 'number',
): { before: unknown; after: unknown } {
  const rename = (ast: File): void => {
    renameIdentifiers(ast, { seed: 0, stringGeneratorMode: mode })
  }
  return { before: trace(code), after: trace(run(code, rename)) }
}

function runBoth(code: string): { before: unknown; after: unknown } {
  return runBothWith(code, 'mangled')
}

test('renameIdentifiers does not rename a binding referenced inside a with block', () => {
  const { before, after } = runBoth('var x = 1; var o = { x: 42 }; with (o) { log(x); }')
  expect(after).toEqual(before)
})

test('renameIdentifiers does not rename locals in a function with direct eval', () => {
  const { before, after } = runBoth("function f() { var x = 42; return eval('x'); } log(f());")
  expect(after).toEqual(before)
})

test('renameIdentifiers does not generate a name that captures a free reference', () => {
  const { before, after } = runBoth(
    'function f() { var q = 1; return e; } try { log(f()); } catch (error) { log(error.constructor.name); }',
  )
  expect(after).toEqual(before)
})

test('renameIdentifiers keeps import/export external names intact', () => {
  const importOut = run("import { a } from 'm'; log(a);", renameMangled)
  expect(importOut).toMatch(/import\s*\{\s*a as \w+\s*\}\s*from ['"]m['"]/)
  const exportOut = run('let a = 1; export { a };', renameMangled)
  expect(exportOut).toMatch(/export\s*\{\s*\w+ as a\s*\}/)
})

test('renameIdentifiers reserves an eval-pinned outer name in a nested scope (A10-01)', () => {
  const { before, after } = runBoth(
    "var M = 1; function e() { eval(''); } function f() { var q = 2; log(M, q); } f();",
  )
  expect(after).toEqual(before)
})

test('renameIdentifiers reserves a with-pinned outer name in a nested scope (A10-01)', () => {
  const { before, after } = runBoth(
    'var M = 1; with ({}) { log(M); } function f() { var q = 2; log(M, q); } f();',
  )
  expect(after).toEqual(before)
})

test('renameIdentifiers does not rename a sibling onto a pinned name (A10-02)', () => {
  const { before, after } = runBothWith(
    'function f() { var q = 1; var var_2 = 2; with ({}) { log(var_2); } log(q, var_2); } f();',
    'number',
  )
  expect(after).toEqual(before)
})

test('renameIdentifiers keeps a sloppy block-level function reachable by its outer callers (A10-03)', () => {
  const { before, after } = runBoth('{ function g() { return 41; } } log(g() + 1);')
  expect(after).toEqual(before)
})

test('renameIdentifiers keeps a sloppy switch-case function reachable (A10-03)', () => {
  const { before, after } = runBoth(
    'switch (1) { case 1: function h() { return 2; } } log(typeof h);',
  )
  expect(after).toEqual(before)
})

test('renameIdentifiers does not collide a block function with an outer binding (A10-04)', () => {
  const { before, after } = runBoth(
    'var out = []; { function g() { return 1; } } out.push(typeof g); log(out);',
  )
  expect(after).toEqual(before)
})

test('renameIdentifiers preserves Annex B if-clause function hoisting (A09-14)', () => {
  const { before, after } = runBoth(
    'log(typeof f); if (1) { function f() { return 1; } } log(typeof f, f());',
  )
  expect(after).toEqual(before)
})

test('renameIdentifiers keeps a catch param and a same-named catch-body var as one variable (A10-05)', () => {
  const { before, after } = runBoth(
    "function f() { try { throw 'x'; } catch (e) { var e = 5; log(e); } log(typeof e); } f();",
  )
  expect(after).toEqual(before)
})

test('renameIdentifiers never rewrites a PrivateName field, method, or brand check (A10-06)', () => {
  const field = runBoth('class C { #a = 1; read(a) { return this.#a + a; } } log(new C().read(5));')
  expect(field.after).toEqual(field.before)
  expect(field.after).toEqual({ logs: [6], threw: null })

  const method = runBoth(
    'class C { #m() { return 1; } run(m) { return this.#m() + m; } } log(new C().run(2));',
  )
  expect(method.after).toEqual(method.before)
  expect(method.after).toEqual({ logs: [3], threw: null })

  const brand = runBoth(
    'class C { #a = 1; static has(o, a) { return (#a in o) && a; } } log(C.has(new C(), true));',
  )
  expect(brand.after).toEqual(brand.before)
  expect(brand.after).toEqual({ logs: [true], threw: null })
})

test('renameIdentifiers reserves an assignment-only undeclared global (A10-07)', () => {
  try {
    const compound = runBothWith(
      'var_2 = 0; function f() { var q = 1; var_2 += 1; log(q); } f();',
      'number',
    )
    expect(compound.after).toEqual(compound.before)
    const destructured = runBothWith(
      'var_2 = 5; function f() { var q = 1; [var_2] = [99]; log(q); } f();',
      'number',
    )
    expect(destructured.after).toEqual(destructured.before)
  } finally {
    delete (globalThis as Record<string, unknown>)['var_2']
  }
})
