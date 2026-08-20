import { createContext, runInContext } from 'node:vm'

import { expect, test } from 'vitest'

import { constLetToVar } from 'src/transforms/const-let-to-var'

import { defineCases, run } from '../helpers'

// Compare logs and thrown classes before and after lexical lifting.
function capture(code: string): { logs: string[]; threw: string | null } {
  const logs: string[] = []
  try {
    // oxlint-disable-next-line no-new-func
    new Function('log', code)((...values: unknown[]) => logs.push(values.map(String).join('|')))
    return { logs, threw: null }
  } catch (error) {
    return { logs, threw: (error as Error).constructor.name }
  }
}

function expectEquivalent(input: string): string {
  const out = run(input, constLetToVar)
  expect(capture(out)).toEqual(capture(input))
  return out
}

const cases = defineCases('const-let-to-var', constLetToVar, {
  simpleLetInFunction: {
    name: 'constLetToVar lifts a function-scoped let to var',
    input: `(function () { let foo = "bar"; log(foo); })();`,
  },
  simpleConstInFunction: {
    name: 'constLetToVar lifts a function-scoped const with no reassignment to var',
    input: `(function () { const foo = "bar"; log(foo); })();`,
  },
  blockShadowingRenamed: {
    name: 'constLetToVar alpha-renames same-named let bindings in sibling blocks',
    input: `(function () {
  { let x = 1; log(x); }
  { let x = 2; log(x); }
})();`,
  },
  blockShadowingOuterPreserved: {
    name: 'constLetToVar renames the inner shadow when lifting nested let bindings',
    input: `(function () {
  let x = 1;
  { let x = 2; log(x); }
  log(x);
})();`,
  },
  loopWithoutClosure: {
    name: 'constLetToVar lifts a for-head let that no closure captures',
    input: `(function () {
  for (let i = 0; i < 3; i++) { log(i); }
})();`,
  },
  forOfLet: {
    name: 'constLetToVar lifts a for-of let head',
    input: `(function () {
  for (let v of [1, 2]) { log(v); }
})();`,
  },
  emptyLoopBodyLet: {
    name: 'constLetToVar resets a loop-body let with no initializer per iteration',
    input: `(function () {
  for (var i = 0; i < 3; i++) { let a; log(typeof a); a = i; }
})();`,
  },
  classDeclarationConflictRenamed: {
    name: 'constLetToVar renames a class declaration that would shadow a lifted binding',
    input: `(function () {
  let A = "outer";
  { class A {} log(typeof A); }
  log(A);
})();`,
  },
  preservesShadowInsideFunctions: {
    name: 'constLetToVar keeps separate let bindings in sibling functions independent',
    input: `function f() { let x = 1; return x; }
function g() { let x = 2; return x; }
log(f(), g());`,
  },
  loopCaptureLeftAsLet: {
    name: 'constLetToVar leaves a closure-captured loop let alone',
    input: `(function () {
  var fns = [];
  for (let i = 0; i < 3; i++) { fns.push(function () { return i; }); }
  fns.forEach(function (g) { log(g()); });
})();`,
  },
  leavesVarAlone: {
    name: 'constLetToVar leaves existing var declarations alone',
    input: `var foo = 1; log(foo);`,
  },
})

test(cases.simpleLetInFunction.name, () => {
  const out = expectEquivalent(cases.simpleLetInFunction.input)
  expect(out).toContain('var foo = "bar"')
  expect(out).not.toContain('let')
})

test(cases.simpleConstInFunction.name, () => {
  const out = expectEquivalent(cases.simpleConstInFunction.input)
  expect(out).toContain('var foo = "bar"')
  expect(out).not.toContain('const')
})

test(cases.blockShadowingRenamed.name, () => {
  const out = expectEquivalent(cases.blockShadowingRenamed.input)
  expect(out).not.toContain('let')
  expect(out.match(/var x = 1/g)?.length).toBe(1)
  expect(out.match(/var x = 2/g)?.length ?? 0).toBe(0)
})

test(cases.blockShadowingOuterPreserved.name, () => {
  const out = expectEquivalent(cases.blockShadowingOuterPreserved.input)
  expect(out).not.toContain('let')
  expect(out).toContain('var x = 1')
})

test(cases.loopWithoutClosure.name, () => {
  const out = expectEquivalent(cases.loopWithoutClosure.input)
  expect(out).not.toContain('let')
  expect(out).not.toContain('_loop')
  expect(out).toContain('for (var i = 0')
})

test(cases.forOfLet.name, () => {
  const out = expectEquivalent(cases.forOfLet.input)
  expect(out).not.toContain('let')
  expect(out).toContain('for (var v of')
})

test(cases.emptyLoopBodyLet.name, () => {
  const out = expectEquivalent(cases.emptyLoopBodyLet.input)
  expect(out).not.toContain('let')
  expect(out).toContain('var a = void 0')
})

test(cases.classDeclarationConflictRenamed.name, () => {
  const out = expectEquivalent(cases.classDeclarationConflictRenamed.input)
  expect(out).toContain('var A = "outer"')
})

test(cases.preservesShadowInsideFunctions.name, () => {
  const out = expectEquivalent(cases.preservesShadowInsideFunctions.input)
  expect(out).not.toContain('let')
  expect(out.match(/var x = 1/g)?.length).toBe(1)
  expect(out.match(/var x = 2/g)?.length).toBe(1)
})

test(cases.loopCaptureLeftAsLet.name, () => {
  // One shared `var` would collapse per-iteration captures.
  const out = expectEquivalent(cases.loopCaptureLeftAsLet.input)
  expect(out).toContain('let i')
  expect(out).not.toContain('_loop')
})

test(cases.leavesVarAlone.name, () => {
  const out = expectEquivalent(cases.leavesVarAlone.input)
  expect(out).toContain('var foo = 1')
})

// A04-01b: A constant reassignment must keep throwing.
test('A04-01b constLetToVar leaves a reassigned const alone', () => {
  const src = `const a = 1; try { a = 2; } catch (e) { log(e.constructor.name); } log(a);`
  const out = expectEquivalent(src)
  expect(out).toContain('const a = 1')
})

// A04-03: A pre-declaration write must remain in TDZ.
test('A04-03 constLetToVar preserves a TDZ write before the declaration', () => {
  const out = expectEquivalent(`(function () { log('a'); x = 5; let x = 1; log(x); })();`)
  expect(out).toContain('let x = 1')
})

// A04-04: Entering a later switch case can skip a shared lexical initializer.
test('A04-04 constLetToVar preserves a cross-case switch TDZ', () => {
  const out = expectEquivalent(
    `(function () {
  switch (1) {
    case 0: let a = 1; log(a); break;
    case 1: log(a); break;
  }
})();`,
  )
  expect(out).toContain('let a = 1')
})

// A04-05: A hoisted closure can run before lexical initialization.
test('A04-05 constLetToVar preserves a TDZ read from a pre-call hoisted function', () => {
  const out = expectEquivalent(
    `(function () {
  log(f());
  let x = 1;
  function f() { return x; }
})();`,
  )
  expect(out).toContain('let x = 1')
})

// A04-06: A loop-head self-reference reads its own TDZ binding.
test('A04-06 constLetToVar preserves a for-head TDZ self-reference', () => {
  const out = expectEquivalent(
    `(function () {
  var fns = [];
  try {
    for (let i = i; i < 1; i++) { fns.push(function () { return i; }); }
  } catch (e) { log(e.constructor.name); }
  log(fns.length);
})();`,
  )
  expect(out).toContain('let i = i')
})

// A04-07: A closure in the loop test captures each iteration's binding.
test('A04-07 constLetToVar leaves a for-test closure capture alone', () => {
  const out = expectEquivalent(
    `(function () {
  var fns = [];
  function t(f) { fns.push(f); return true; }
  for (let i = 0; t(function () { return i; }) && i < 2; i++) {}
  fns.forEach(function (g) { log(g()); });
})();`,
  )
  expect(out).toContain('let i = 0')
})

// A04-08: A closure in the loop update captures each iteration's binding.
test('A04-08 constLetToVar leaves a for-update closure capture alone', () => {
  const out = expectEquivalent(
    `(function () {
  var fns = [];
  function t(f) { fns.push(f); return 1; }
  for (let i = 0; i < 2; i = i + t(function () { return i; })) {}
  fns.forEach(function (g) { log(g()); });
})();`,
  )
  expect(out).toContain('let i = 0')
})

// A04-09: `with` can intercept a lifted name outside Babel's scope table.
test('A04-09 constLetToVar leaves a let inside `with` alone', () => {
  const out = expectEquivalent(`var o = { y: 'prop' }; with (o) { let y = 1; log(y); } log(o.y);`)
  expect(out).toContain('let y = 1')
})

// A04-10: A `for-of` write must retain the captured per-iteration binding.
test('A04-10 constLetToVar leaves a for-of write to a captured head alone', () => {
  expectEquivalent(
    `(function () {
  var fns = [];
  for (let i = 0; i < 3; i++) { fns.push(function () { return i; }); for (i of [9]) {} }
  log(fns.length);
  fns.forEach(function (f) { log(f()); });
})();`,
  )
})

// A04-11: A destructured loop-head write must remain a pattern.
test('A04-11 constLetToVar leaves a destructuring write to a captured head alone', () => {
  const out = expectEquivalent(
    `(function () {
  var fns = [];
  for (let i = 0; i < 3; i++) { fns.push(function () { return i; }); [i] = [9]; }
  log(fns.length);
  fns.forEach(function (f) { log(f()); });
})();`,
  )
  expect(out).toContain('[i] = [9]')
})

// A04-12: An uninitialized lexical loop head resets on each entry.
test('A04-12 constLetToVar leaves an uninitialized for-head let alone', () => {
  const out = expectEquivalent(
    `(function () {
  var out = [];
  for (var i = 0; i < 2; i++) { for (let j; ; ) { out.push(typeof j); j = 1; break; } }
  log(out.join(','));
})();`,
  )
  expect(out).toContain('let j')
})

// A04-13: An Annex B function inside the loop must keep its outer alias.
test('A04-13 constLetToVar preserves Annex B hoisting from a captured loop', () => {
  const out = expectEquivalent(
    `(function () {
  var Q = [];
  for (var i = 0; i < 2; i++) {
    { function h() { return 1; } }
    let k = i;
    Q.push(function () { return k; });
  }
  log(typeof h);
  Q.forEach(function (f) { log(f()); });
})();`,
  )
  expect(out).toContain('let k')
})

// A04-14: Top-level lexical bindings must not become global properties.
test('A04-14 constLetToVar leaves top-level lexical bindings off the global object', () => {
  const src = `let a = 1; const b = 2; log(typeof globalThis.a, typeof globalThis.b);`
  const out = run(src, constLetToVar)
  expect(out).toContain('let a = 1')
  expect(out).toContain('const b = 2')
  const runInGlobal = (code: string): string[] => {
    const trace: string[] = []
    const ctx = createContext({ log: (...values: unknown[]) => trace.push(values.join('|')) })
    runInContext(code, ctx)
    return trace
  }
  expect(runInGlobal(out)).toEqual(runInGlobal(src))
})

// A04-15: Moving bare `super()` into a function expression is invalid.
test('A04-15 constLetToVar keeps super() inside a captured loop callable', () => {
  expectEquivalent(
    `class A { constructor() { this.v = 1; } }
class B extends A {
  constructor() {
    var Q = [];
    for (let i = 0; i < 1; i++) { Q.push(function () { return i; }); super(); }
    this.Q = Q;
  }
}
var b = new B();
log(b.v, b.Q.length, b.Q[0]());`,
  )
})

// A04-16: Static-block `this` must remain the class.
test('A04-16 constLetToVar preserves class-static-block `this`', () => {
  expectEquivalent(
    `var Q = [];
class C {
  static tag = 'C';
  static {
    for (let i = 0; i < 2; i++) { Q.push(function () { return i; }); log(this.tag); }
  }
}
Q.forEach(function (f) { log(f()); });`,
  )
})
