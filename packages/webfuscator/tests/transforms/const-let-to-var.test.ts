import { expect, test } from 'vitest'

import { obfuscate } from '../../src/obfuscator'
import { constLetToVar } from '../../src/transforms/const-let-to-var'
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

test('constLetToVar rewrites a reassigned const', () => {
  const src = `const a = 1; try { a = 2; } catch (e) { log(e.constructor.name); } log(a);`
  const out = run(src, constLetToVar)
  expect(out).toContain('var a = 1')
})

test('constLetToVar ignores a const write captured by a nested function', () => {
  const out = run('for (const x of [1]) { (function () { x = 2; })(); }', constLetToVar)
  expect(out).toContain('for (var x of')
})

test('constLetToVar rewrites a binding written before its declaration', () => {
  const out = run(`(function () { log('a'); x = 5; let x = 1; log(x); })();`, constLetToVar)
  expect(out).toContain('var x = 1')
})

test('constLetToVar rewrites a cross-case binding read before initialization', () => {
  const out = run(
    `(function () {
  switch (1) {
    case 0: let a = 1; log(a); break;
    case 1: log(a); break;
  }
})();`,
    constLetToVar,
  )
  expect(out).toContain('var a = 1')
})

test('constLetToVar rewrites a binding read by an early function call', () => {
  const out = run(
    `(function () {
  log(f());
  let x = 1;
  function f() { return x; }
})();`,
    constLetToVar,
  )
  expect(out).toContain('var x = 1')
})

test('constLetToVar rewrites a loop-head self-reference', () => {
  const out = run(
    `(function () {
  try {
    for (let i = i; i < 1; i++) { log(i); }
  } catch (e) { log(e.constructor.name); }
})();`,
    constLetToVar,
  )
  expect(out).toContain('var i = i')
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

test('constLetToVar rewrites a let inside with', () => {
  const out = run(`var o = { y: 'prop' }; with (o) { let y = 1; log(y); } log(o.y);`, constLetToVar)
  expect(out).toContain('var y = 1')
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

test('constLetToVar keeps a captured loop binding with a nested function', () => {
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

test('constLetToVar rewrites top-level script lexicals', () => {
  const src = `let a = 1; const b = 2; log(typeof globalThis.a, typeof globalThis.b);`
  const out = run(src, constLetToVar)
  expect(out).toContain('var a = 1')
  expect(out).toContain('var b = 2')
})

test('A04-14b constLetToVar lifts top-level module lexicals', () => {
  const out = run(
    `export {};
let a = 1;
const b = 2;
a + b;`,
    constLetToVar,
  )
  expect(out).toContain('var a = 1')
  expect(out).toContain('var b = 2')
})

test('A04-14d constLetToVar rewrites exported module lexicals', () => {
  const out = run(
    `export let a = 1;
export const b = 2;
let c = 3;
export { c };
let d = 4;
a + b + c + d;`,
    constLetToVar,
  )
  expect(out).toContain('export var a = 1')
  expect(out).toContain('export var b = 2')
  expect(out).toContain('var c = 3')
  expect(out).toContain('export { c }')
  expect(out).toContain('var d = 4')
})

test('the public pipeline hoists rewritten top-level script lexicals', () => {
  const src = `let x = 1; log(typeof globalThis.x);`
  const out = obfuscate(src, {
    transforms: { constLetToVar: true, hoistVariables: true },
  })
  expect(out).toContain('var x;')
  expect(out).not.toContain('let x')
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
