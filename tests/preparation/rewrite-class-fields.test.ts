import { expect, test } from 'vitest'

import { rewriteClassFields } from 'src/preparation/rewrite-class-fields'

import { defineCases, run, trace } from '../helpers'

const cases = defineCases('rewrite-class-fields', rewriteClassFields, {
  movesInstanceFields: {
    name: 'rewriteClassFields moves instance fields into a new constructor',
    input: `class A {
      x = 1;
      y = compute();
    }`,
  },
  liftsStaticFields: {
    name: 'rewriteClassFields lifts static fields into post-class assignments',
    input: `class A {
      static z = 2;
      static w = compute();
    }`,
  },
  movesInstanceAndStaticFields: {
    name: 'rewriteClassFields moves instance and static fields in the same class',
    input: `class A {
      x = 1;
      y = compute();
      static z = 2;
      static w = compute();
    }`,
  },
  preservesDeclarationOrder: {
    name: 'rewriteClassFields preserves declaration order of instance assignments',
    input: `class A {
      x = 1;
      y = 2;
    }`,
  },
  prependsToExistingConstructor: {
    name: 'rewriteClassFields prepends to an existing constructor',
    input: `class A {
      x = 1;
      constructor() {
        log("ran");
      }
    }`,
  },
  leavesDerivedClassFieldsUntouched: {
    name: 'rewriteClassFields leaves a derived class untouched (a plain assignment could hit an inherited setter)',
    input: `class A extends B {
      x = 1;
      constructor() {
        super();
        log("ran");
      }
    }`,
  },
  defaultsToUndefined: {
    name: 'rewriteClassFields assigns undefined for fields without initializers',
    input: `class A {
      x;
    }`,
  },
  leavesFieldlessClassesUntouched: {
    name: 'rewriteClassFields leaves classes without fields unchanged',
    input: `class A {
      m() {
        return 1;
      }
    }`,
  },
  preservesComputedKeys: {
    name: 'rewriteClassFields preserves computed field keys',
    input: `class A {
      [k] = 1;
    }`,
  },
})

test(cases.movesInstanceFields.name, () => {
  const out = run(cases.movesInstanceFields.input, rewriteClassFields)
  expect(out).toContain('constructor()')
  expect(out).toContain('Object.defineProperty(this, "x"')
  expect(out).toContain('value: 1')
  expect(out).toContain('Object.defineProperty(this, "y"')
  expect(out).toContain('value: compute()')
  expect(out).not.toMatch(/^\s*x\s*=/m)
})

test(cases.liftsStaticFields.name, () => {
  const out = run(cases.liftsStaticFields.input, rewriteClassFields)
  expect(out).toContain('static {')
  expect(out).toContain('Object.defineProperty(this, "z"')
  expect(out).toContain('value: 2')
  expect(out).toContain('Object.defineProperty(this, "w"')
  expect(out).toContain('value: compute()')
  expect(out).not.toContain('static z')
  expect(out).not.toContain('static w')
})

test(cases.movesInstanceAndStaticFields.name, () => {
  const out = run(cases.movesInstanceAndStaticFields.input, rewriteClassFields)
  expect(out).toContain('constructor()')
  expect(out).toContain('Object.defineProperty(this, "x"')
  expect(out).toContain('Object.defineProperty(this, "y"')
  expect(out).toContain('static {')
  expect(out).toContain('Object.defineProperty(this, "z"')
  expect(out).toContain('Object.defineProperty(this, "w"')
})

test(cases.preservesDeclarationOrder.name, () => {
  const out = run(cases.preservesDeclarationOrder.input, rewriteClassFields)
  expect(out.indexOf('Object.defineProperty(this, "x"')).toBeLessThan(
    out.indexOf('Object.defineProperty(this, "y"'),
  )
})

test(cases.prependsToExistingConstructor.name, () => {
  const out = run(cases.prependsToExistingConstructor.input, rewriteClassFields)
  expect(out.indexOf('Object.defineProperty(this, "x"')).toBeLessThan(out.indexOf('log("ran")'))
})

test(cases.leavesDerivedClassFieldsUntouched.name, () => {
  const out = run(cases.leavesDerivedClassFieldsUntouched.input, rewriteClassFields)
  expect(out).toContain('x = 1')
  expect(out).not.toContain('this.x = 1')
})

test(cases.defaultsToUndefined.name, () => {
  const out = run(cases.defaultsToUndefined.input, rewriteClassFields)
  expect(out).toContain('Object.defineProperty(this, "x"')
  expect(out).toContain('value: void 0')
})

test(cases.leavesFieldlessClassesUntouched.name, () => {
  const out = run(cases.leavesFieldlessClassesUntouched.input, rewriteClassFields)
  expect(out).toContain('m()')
  expect(out).not.toContain('constructor')
})

test(cases.preservesComputedKeys.name, () => {
  const out = run(cases.preservesComputedKeys.input, rewriteClassFields)
  // A computed field key runs once, not once per instance.
  expect(out).toContain('[k] = 1')
  expect(out).not.toContain('this[k]')
  expect(out).not.toContain('constructor')
})

// Compare logs and thrown classes between original and transformed programs.

function expectPreservesBehavior(src: string): string {
  const out = run(src, rewriteClassFields)
  expect(trace(out)).toEqual(trace(src))
  return out
}

test('rewriteClassFields handles literal and initializer-less field keys without crashing', () => {
  expect(() => run("class A { 'lit' = 1; }", rewriteClassFields)).not.toThrow()
  expectPreservesBehavior("class A { 'lit' = 1; } log(new A()['lit']);")
  expectPreservesBehavior('class A { 0 = 1; } log(new A()[0]);')
  expectPreservesBehavior('class A { 1n = 1; } log(new A()[1]);')
  expectPreservesBehavior("class A { 'lit'; } log('lit' in new A());")
  expectPreservesBehavior('class A { static 1 = 2; } log(A[1]);')
  expectPreservesBehavior("class A { static 'x' = 2; } log(A.x);")
})

test('rewriteClassFields does not re-evaluate a computed key per instance', () => {
  expectPreservesBehavior(
    'let i = 0; class A { [i++] = "v"; } log(Object.keys(new A()).join(","), Object.keys(new A()).join(","));',
  )
})

test('rewriteClassFields does not defer computed key evaluation to construction', () => {
  expectPreservesBehavior(
    'function k(){ log("k"); return "x"; } class A { [k()] = 1; } log("defined"); new A();',
  )
})

test('rewriteClassFields preserves this in a static field initializer', () => {
  expectPreservesBehavior(
    'function t(){ class A { static s = this; } return A.s === A; } log(t());',
  )
})

test('rewriteClassFields preserves static field / static block order', () => {
  expectPreservesBehavior('class A { static x = 1; static { log(A.x); } } log(A.x);')
})

test('rewriteClassFields preserves order for a class expression with static fields', () => {
  expectPreservesBehavior('const C = class { static a = log("a"); static { log("b"); } };')
})

test('rewriteClassFields does not turn a field define into an inherited [[Set]]', () => {
  expectPreservesBehavior(
    'class B { set x(v) { log("setter"); } get x() { return "proto"; } } class A extends B { x = 1; } let a = new A(); log(a.x);',
  )
  expectPreservesBehavior(
    'class B {} Object.defineProperty(B.prototype, "x", { value: 1, writable: false, configurable: true }); class A extends B { x = 2; } try { log(String(new A().x)); } catch (error) { log(error.constructor.name); }',
  )
})

test('rewriteClassFields preserves a __proto__ field as an own property', () => {
  expectPreservesBehavior('class A { __proto__ = 1; } log(Object.keys(new A()));')
})

test('rewriteClassFields preserves a static length field', () => {
  expectPreservesBehavior('class A { static length = 5; } log(A.length);')
})

test('rewriteClassFields does not capture a constructor parameter or local', () => {
  expectPreservesBehavior(
    "let v = 'outer'; class A { x = v; constructor(v) {} } log(new A('inner').x);",
  )
  expectPreservesBehavior(
    "let w = 'outer'; class A { x = w; constructor() { let w = 'inner'; } } log(new A().x);",
  )
})

test('rewriteClassFields materializes a missing initializer as unshadowable void 0', () => {
  const out = run('class A { x; }', rewriteClassFields)
  expect(out).toContain('void 0')
  expectPreservesBehavior(
    'function t() { let undefined = 42; class A { x; } return new A().x; } log(t());',
  )
})

test('rewriteClassFields preserves public/private field init order', () => {
  expectPreservesBehavior(
    "class A { q = log('q'); #p = log('p'); m() { return this.#p; } } new A();",
  )
})

test('rewriteClassFields preserves new.target inside a field initializer', () => {
  expectPreservesBehavior('class B {} class D extends B { t = new.target; } log(new D().t === D);')
})

test('rewriteClassFields does not run field assignment while this is in TDZ', () => {
  expectPreservesBehavior(
    'class B {} class D extends B { x = 1; constructor() { log("pre"); super(); } } try { log(String(new D().x)); } catch (error) { log(error.constructor.name); }',
  )
})

test('rewriteClassFields keeps a static field whose initializer names a private member', () => {
  const out = expectPreservesBehavior(
    'class A { static #m() { return 7; } static x = A.#m(); } log(A.x);',
  )
  // Moving `A.#m()` outside the class would be a syntax error.
  expect(out).not.toContain('A.x =')
})

test('rewriteClassFields keeps a field shadowed by a same-named accessor', () => {
  expectPreservesBehavior(
    'class A { set x(v) { log("setter"); } x = 5; } log(Object.getOwnPropertyDescriptor(new A(), "x").value);',
  )
  expectPreservesBehavior('class A { static get x() { return 1; } static x = 5; } log(A.x);')
})

test('rewriteClassFields keeps a field when an accessor key is computed', () => {
  expectPreservesBehavior('var k = "x"; class A { get [k]() { return 1; } x = 5; } log(new A().x);')
})

// A09-01: Base fields initialize before constructor parameter defaults.
test('rewriteClassFields keeps a field when the constructor parameter list is not simple', () => {
  const out = expectPreservesBehavior(
    'class A { x = 1; constructor(p = this.x) { log(p); } } new A();',
  )
  expect(out).toContain('x = 1')
  expectPreservesBehavior(
    'class A { x = 1; constructor({ p = this.x } = {}) { log(p); } } new A();',
  )
  expectPreservesBehavior(
    'class A { x; constructor(p = Object.keys(this).length) { log(p); } } new A();',
  )
})

// A09-02: Function prototype accessors poison static `caller` and `arguments`.
test('rewriteClassFields keeps a static field named caller or arguments', () => {
  const out = expectPreservesBehavior('class A { static caller = 1; } log(A.caller);')
  expect(out).toContain('static caller = 1')
  expectPreservesBehavior('class A { static arguments = 1; } log(A.arguments);')
  expectPreservesBehavior('class A { static "caller" = 1; } log(A.caller);')
})

// A09-03 / A09-04: Field definition must ignore inherited setters and read-only
// properties.
test('rewriteClassFields installs an instance field with define semantics, not [[Set]]', () => {
  const out = expectPreservesBehavior(
    'class A { x = 1; }\n' +
      'Object.setPrototypeOf(A.prototype, { set x(v) { log("setter", v); }, get x() { return 7; } });\n' +
      'var a = new A();\n' +
      'log(Object.prototype.hasOwnProperty.call(a, "x"), a.x);',
  )
  expect(out).toContain('Object.defineProperty(this, "x"')
  expectPreservesBehavior(
    'class A { x = 1; }\n' +
      'var proto = {};\n' +
      'Object.defineProperty(proto, "x", { value: 0, writable: false });\n' +
      'Object.setPrototypeOf(A.prototype, proto);\n' +
      'try { var a = new A(); log("ok", a.x); } catch (e) { log("threw", e.constructor.name); }',
  )
})

// A09-05: Static initializers capture the inner class binding, and descriptors can
// change inferred function names.
test('rewriteClassFields keeps a static field whose initializer is an anonymous function', () => {
  const out = expectPreservesBehavior(
    'class A { static f = () => A; } var g = A.f; A = 5; log(g() === 5, typeof g());',
  )
  expect(out).toContain('static f = () => A')
  expectPreservesBehavior(
    'class A { static f = function () { return A; }; } var g = A.f; A = 5; log(typeof g(), g() === 5);',
  )
})

// A09-06: A static block keeps assignment bound to the immutable inner class name.
test('rewriteClassFields preserves the immutable inner class binding for a lowered static field', () => {
  const out = expectPreservesBehavior(
    'class A { static f = (() => { try { A = 1; return "no-throw"; } catch (e) { return e.constructor.name; } })(); }\n' +
      'log(A && A.f);',
  )
  expect(out).toContain('static {')
  expect(out).toContain('Object.defineProperty(this, "f"')
})
