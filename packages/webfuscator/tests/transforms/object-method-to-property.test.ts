import { expect, test } from 'vitest'

import { objectMethodToProperty } from '../../src/transforms/object-method-to-property'
import { defineCases, run } from '../helpers'

const cases = defineCases('object-method-to-property', objectMethodToProperty, {
  basicMethod: {
    name: 'objectMethodToProperty leaves a plain method concise',
    input: `const o = {
  greet(name) {
    return "hi " + name;
  },
};`,
  },
  thisBinding: {
    name: 'objectMethodToProperty preserves this at the call site',
    input: `const o = {
  base: 10,
  add(n) {
    return this.base + n;
  },
};`,
  },
  generator: {
    name: 'objectMethodToProperty preserves a generator method',
    input: `const o = {
  *gen() {
    yield 1;
    yield 2;
  },
};`,
  },
  nameInference: {
    name: 'objectMethodToProperty keeps the inferred function name',
    input: `const o = {
  m() {},
};`,
  },
  computedKey: {
    name: 'objectMethodToProperty preserves a computed key',
    input: `const key = "dyn";
const o = {
  [key]() {
    return 7;
  },
};`,
  },
  computedLiteralKeyName: {
    name: 'objectMethodToProperty keeps the inferred name for a computed string-literal key',
    input: `const o = {
  ["m"]() {
    return 1;
  },
};`,
  },
  asyncMethod: {
    name: 'objectMethodToProperty preserves an async method',
    input: `const o = {
  async double(n) {
    return n * 2;
  },
};`,
  },
  getterUntouched: {
    name: 'objectMethodToProperty leaves a getter alone',
    input: `const o = {
  get x() {
    return 42;
  },
};`,
  },
  setterUntouched: {
    name: 'objectMethodToProperty leaves a setter alone',
    input: `let store = 0;
const o = {
  set v(n) {
    store = n;
  },
};
o.v = 9;`,
  },
  superUntouched: {
    name: 'objectMethodToProperty leaves a method that reaches super alone',
    input: `const proto = {
  greet() {
    return "base";
  },
};
const o = {
  __proto__: proto,
  greet() {
    return super.greet() + "!";
  },
};`,
  },
})

function evalWith(src: string, observe: string): unknown {
  // oxlint-disable-next-line no-new-func
  return new Function(`${src}\nreturn (${observe});`)()
}

function expectEquivalent(input: string, observe: string): string {
  const out = run(input, objectMethodToProperty)
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
  return out
}

test(cases.basicMethod.name, () => {
  // A function property would make a plain method constructible with a prototype.
  const out = expectEquivalent(cases.basicMethod.input, 'o.greet("bob")')
  expect(out).toMatch(/greet\(name\)/)
  expect(out).not.toContain('greet: function')
  expect(evalWith(out, 'o.greet("bob")')).toBe('hi bob')
})

test(cases.thisBinding.name, () => {
  const out = expectEquivalent(cases.thisBinding.input, 'o.add(5)')
  expect(evalWith(out, 'o.add(5)')).toBe(15)
})

test(cases.generator.name, () => {
  const out = expectEquivalent(cases.generator.input, '[...o.gen()]')
  expect(out).toContain('gen: function*')
  expect(evalWith(out, '[...o.gen()]')).toEqual([1, 2])
})

test(cases.nameInference.name, () => {
  const out = expectEquivalent(cases.nameInference.input, 'o.m.name')
  expect(evalWith(out, 'o.m.name')).toBe('m')
})

test(cases.computedKey.name, () => {
  const out = expectEquivalent(cases.computedKey.input, 'o.dyn()')
  expect(out).toMatch(/\[key\]\(\)/)
  expect(evalWith(out, 'o.dyn()')).toBe(7)
})

test(cases.computedLiteralKeyName.name, () => {
  const out = expectEquivalent(cases.computedLiteralKeyName.input, 'o.m.name')
  expect(out).toMatch(/\["m"\]\(\)/)
  expect(evalWith(out, 'o.m.name')).toBe('m')
})

test(cases.asyncMethod.name, async () => {
  const out = run(cases.asyncMethod.input, objectMethodToProperty)
  expect(out).toContain('double: async function')
  const result = await (evalWith(out, 'o.double(21)') as Promise<unknown>)
  expect(result).toBe(42)
})

test(cases.getterUntouched.name, () => {
  const out = expectEquivalent(cases.getterUntouched.input, 'o.x')
  expect(out).toMatch(/get x\(\)/)
  expect(evalWith(out, 'o.x')).toBe(42)
})

test(cases.setterUntouched.name, () => {
  const out = expectEquivalent(cases.setterUntouched.input, 'store')
  expect(out).toMatch(/set v\(n\)/)
})

test(cases.superUntouched.name, () => {
  const out = expectEquivalent(cases.superUntouched.input, 'o.greet()')
  expect(out).toMatch(/greet\(\)\s*\{\s*return super\.greet/)
  expect(evalWith(out, 'o.greet()')).toBe('base!')
})

test('objectMethodToProperty leaves a plain method so it stays a non-constructor', () => {
  const src =
    'const o = { m() {} }; try { new o.m(); log("constructed"); } catch (error) { log(error.constructor.name); }'
  const out = run(src, objectMethodToProperty)
  expect(out).toContain('m() {}')
  const trace = (code: string): unknown[] => {
    const logs: unknown[] = []
    // oxlint-disable-next-line no-new-func
    new Function('log', code)((v: unknown) => logs.push(v))
    return logs
  }
  expect(trace(out)).toEqual(trace(src))
})

test('objectMethodToProperty does not demote a method whose computed-key super it misses', () => {
  const src = 'var o = { f() { return class { [super.constructor.name]() {} }; } };'
  const out = run(src, objectMethodToProperty)
  expect(() => new Function(out)).not.toThrow()
  expect(out).toContain('f() {')
})

// ECMA-262 B.3.1 makes the non-computed property form set the prototype.
test('objectMethodToProperty leaves a generator __proto__ method alone', () => {
  const input = 'var o = { get z() { return 0; }, ...{}, *__proto__() {} };'
  const out = run(input, objectMethodToProperty)
  expect(out).toContain('*__proto__()')
  const observe =
    '[Object.getPrototypeOf(o) === Object.prototype, Object.keys(o), typeof o.__proto__, Object.getOwnPropertyDescriptor(o, "__proto__").enumerable]'
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
})

test('objectMethodToProperty leaves an async __proto__ method alone', () => {
  const input = 'var o = { get z() { return 0; }, ...{}, async __proto__() {} };'
  const out = run(input, objectMethodToProperty)
  expect(out).toContain('async __proto__()')
  const observe =
    '[Object.getPrototypeOf(o) === Object.prototype, Object.keys(o), typeof o.__proto__]'
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
})

// A `__proto__` method may coexist with the setter form, but two property forms
// would be a duplicate-key syntax error.
test('objectMethodToProperty does not collide a __proto__ method with a __proto__ setter', () => {
  const input = 'var o = { get z() { return 0; }, ...{}, *__proto__() {}, __proto__: { p: 1 } };'
  const out = run(input, objectMethodToProperty)
  expect(() => new Function(out)).not.toThrow()
  const observe = '[o.p, typeof o.__proto__, Object.getPrototypeOf(o).p]'
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
})

// A computed `__proto__` key always creates an own property.
test('objectMethodToProperty still demotes a computed __proto__ method', () => {
  const input = 'var o = { *["__proto__"]() { yield 1; } };'
  const out = run(input, objectMethodToProperty)
  expect(out).toContain('["__proto__"]: function*')
  const observe =
    '[Object.getPrototypeOf(o) === Object.prototype, typeof o.__proto__, [...o.__proto__()]]'
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
})
