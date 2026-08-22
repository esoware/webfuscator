import { expect, test } from 'vitest'

import { stringifyObjectKeys } from '../../src/preparation/stringify-object-keys'
import { defineCases, run } from '../helpers'

const cases = defineCases('stringify-object-keys', stringifyObjectKeys, {
  identifierProperty: {
    name: 'stringifyObjectKeys rewrites an identifier property key as a computed string literal',
    input: `var o = { foo: 1 };`,
  },
  shorthandProperty: {
    name: 'stringifyObjectKeys rewrites a shorthand property and unsets shorthand',
    input: `var o = { foo };`,
  },
  numericKey: {
    name: 'stringifyObjectKeys rewrites a numeric property key as a string literal',
    input: `var o = { 1: a, 0.5: b };`,
  },
  stringLiteralKey: {
    name: 'stringifyObjectKeys converts a non-computed string-literal key to computed form',
    input: `var o = { "foo": 1 };`,
  },
  objectMethod: {
    name: 'stringifyObjectKeys rewrites an object method key',
    input: `var o = { bar() { return 2; } };`,
  },
  objectGetterAndSetter: {
    name: 'stringifyObjectKeys rewrites getter and setter keys',
    input: `var o = {
  get x() { return 1; },
  set x(v) {}
};`,
  },
  computedKeyUntouched: {
    name: 'stringifyObjectKeys leaves an already-computed key alone',
    input: `var o = { [computed]: 3 };`,
  },
  spreadElementUntouched: {
    name: 'stringifyObjectKeys leaves spread elements alone',
    input: `var o = { ...other, foo: 1 };`,
  },
  classInstanceMethod: {
    name: 'stringifyObjectKeys rewrites class instance method keys',
    input: `class A {
  m() {}
}`,
  },
  classStaticMethod: {
    name: 'stringifyObjectKeys rewrites class static method keys',
    input: `class A {
  static s() {}
}`,
  },
  classConstructorUntouched: {
    name: 'stringifyObjectKeys leaves a class constructor key as the bare identifier',
    input: `class A {
  constructor() {}
  m() {}
}`,
  },
  classPrivateMethodUntouched: {
    name: 'stringifyObjectKeys leaves a class private method key alone',
    input: `class A {
  #m() {}
}`,
  },
  protoIdentifierKeyUntouched: {
    name: 'stringifyObjectKeys leaves a non-computed __proto__ identifier key alone (it is a prototype setter)',
    input: `var o = { __proto__: parent };`,
  },
  protoStringKeyUntouched: {
    name: 'stringifyObjectKeys leaves a non-computed "__proto__" string key alone (it is a prototype setter)',
    input: `var o = { "__proto__": parent };`,
  },
  protoShorthandStringified: {
    name: 'stringifyObjectKeys stringifies a __proto__ shorthand (shorthand is not a prototype setter)',
    input: `var o = { __proto__ };`,
  },
  protoMethodStringified: {
    name: 'stringifyObjectKeys stringifies a __proto__ object method (methods are not prototype setters)',
    input: `var o = { __proto__() { return 1; } };`,
  },
  combinedExample: {
    name: 'stringifyObjectKeys rewrites all eligible keys in a mixed example',
    input: `var o = {
  foo: 1,
  bar() { return 2; },
  [computed]: 3
};
class A {
  m() {}
  static s() {}
}`,
  },
})

test(cases.identifierProperty.name, () => {
  const out = run(cases.identifierProperty.input, stringifyObjectKeys)
  expect(out).toContain('["foo"]: 1')
  expect(out).not.toMatch(/\bfoo: 1/)
})

test(cases.shorthandProperty.name, () => {
  const out = run(cases.shorthandProperty.input, stringifyObjectKeys)
  expect(out).toContain('["foo"]: foo')
})

test(cases.numericKey.name, () => {
  const out = run(cases.numericKey.input, stringifyObjectKeys)
  expect(out).toContain('["1"]: a')
  expect(out).toContain('["0.5"]: b')
})

test(cases.stringLiteralKey.name, () => {
  const out = run(cases.stringLiteralKey.input, stringifyObjectKeys)
  expect(out).toContain('["foo"]: 1')
})

test(cases.objectMethod.name, () => {
  const out = run(cases.objectMethod.input, stringifyObjectKeys)
  expect(out).toContain('["bar"]()')
})

test(cases.objectGetterAndSetter.name, () => {
  const out = run(cases.objectGetterAndSetter.input, stringifyObjectKeys)
  expect(out).toContain('get ["x"]()')
  expect(out).toContain('set ["x"](v)')
})

test(cases.computedKeyUntouched.name, () => {
  const out = run(cases.computedKeyUntouched.input, stringifyObjectKeys)
  expect(out).toContain('[computed]: 3')
  expect(out).not.toContain('["computed"]')
})

test(cases.spreadElementUntouched.name, () => {
  const out = run(cases.spreadElementUntouched.input, stringifyObjectKeys)
  expect(out).toContain('...other')
  expect(out).toContain('["foo"]: 1')
})

test(cases.classInstanceMethod.name, () => {
  const out = run(cases.classInstanceMethod.input, stringifyObjectKeys)
  expect(out).toContain('["m"]()')
})

test(cases.classStaticMethod.name, () => {
  const out = run(cases.classStaticMethod.input, stringifyObjectKeys)
  expect(out).toContain('static ["s"]()')
})

test(cases.classConstructorUntouched.name, () => {
  const out = run(cases.classConstructorUntouched.input, stringifyObjectKeys)
  expect(out).toMatch(/\bconstructor\(\)/)
  expect(out).not.toContain('["constructor"]')
  expect(out).toContain('["m"]()')
})

test(cases.classPrivateMethodUntouched.name, () => {
  const out = run(cases.classPrivateMethodUntouched.input, stringifyObjectKeys)
  expect(out).toContain('#m()')
  expect(out).not.toContain('["#m"]')
})

test(cases.combinedExample.name, () => {
  const out = run(cases.combinedExample.input, stringifyObjectKeys)
  expect(out).toContain('["foo"]: 1')
  expect(out).toContain('["bar"]()')
  expect(out).toContain('[computed]: 3')
  expect(out).toContain('["m"]()')
  expect(out).toContain('static ["s"]()')
})

test(cases.protoIdentifierKeyUntouched.name, () => {
  const out = run(cases.protoIdentifierKeyUntouched.input, stringifyObjectKeys)
  expect(out).not.toContain('["__proto__"]')
  expect(out).toMatch(/__proto__:\s*parent/)

  const proto = new Function(
    `var parent = { p: 7 };
     ${out}
     return Object.getPrototypeOf(o);`,
  )() as { p: number }
  expect(proto.p).toBe(7)
})

test(cases.protoStringKeyUntouched.name, () => {
  const out = run(cases.protoStringKeyUntouched.input, stringifyObjectKeys)
  expect(out).not.toContain('["__proto__"]')

  const proto = new Function(
    `var parent = { p: 11 };
     ${out}
     return Object.getPrototypeOf(o);`,
  )() as { p: number }
  expect(proto.p).toBe(11)
})

test(cases.protoShorthandStringified.name, () => {
  const out = run(cases.protoShorthandStringified.input, stringifyObjectKeys)
  expect(out).toContain('["__proto__"]: __proto__')

  const result = new Function(
    `var __proto__ = { p: 99 };
     ${out}
     return { proto: Object.getPrototypeOf(o), own: o["__proto__"] };`,
  )() as { proto: object; own: { p: number } }
  expect(result.proto).toBe(Object.prototype)
  expect(result.own.p).toBe(99)
})

test(cases.protoMethodStringified.name, () => {
  const out = run(cases.protoMethodStringified.input, stringifyObjectKeys)
  expect(out).toContain('["__proto__"]()')

  const result = new Function(
    `${out}
     return { proto: Object.getPrototypeOf(o), call: o["__proto__"]() };`,
  )() as { proto: object; call: number }
  expect(result.proto).toBe(Object.prototype)
  expect(result.call).toBe(1)
})

test('stringifyObjectKeys does not reorder an accessor next to a spread', () => {
  const withSpread = 'var o = { ...{}, get g(){ return 1 }, b: 2 }; log(Object.keys(o).join(","));'
  const out = run(withSpread, stringifyObjectKeys)
  const before = new Function('log', withSpread)
  const after = new Function('log', out)
  const beforeKeys: string[] = []
  const afterKeys: string[] = []
  before((k: string) => beforeKeys.push(k))
  after((k: string) => afterKeys.push(k))
  expect(afterKeys).toEqual(beforeKeys)
  expect(out).toContain('get g(')
})
