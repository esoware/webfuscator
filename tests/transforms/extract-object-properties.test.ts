import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'

import { extractObjectProperties } from 'src/transforms/extract-object-properties'

import { defineCases, run, trace } from '../helpers'

const cases = defineCases('extract-object-properties', extractObjectProperties, {
  specObject: {
    name: 'extractObjectProperties extracts each property of a single-binding object literal',
    input: `var o = { foo: 1, bar: 2 };
func(o.foo, o.bar);`,
  },
  specObjectFunctions: {
    name: 'extractObjectProperties extracts arrow-function values from a utils-like object',
    input: `var utils = {
  isString: x => {
    return typeof x === "string";
  },
  isBoolean: x => {
    return typeof x === "boolean";
  }
};
if (utils.isString("foo")) {
  log("ok");
}`,
  },
  specArray: {
    name: 'extractObjectProperties extracts each element of a single-binding array literal',
    input: `var arr = [10, 20, 30];
log(arr[0], arr[2]);`,
  },

  objectComputedStringKey: {
    name: 'extractObjectProperties accepts computed string-literal keys',
    input: `var o = { ["foo"]: 1, ["bar"]: 2 };
func(o.foo, o.bar);`,
  },
  objectBracketAccess: {
    name: 'extractObjectProperties accepts bracket access with a string-literal key',
    input: `var o = { foo: 1 };
func(o["foo"]);`,
  },
  objectMixedKey: {
    name: 'extractObjectProperties accepts a numeric property key when accessed by the same key',
    input: `var o = { 0: "a", 1: "b" };
log(o[0], o[1]);`,
  },
  objectNamedFunctionExpressionNoThis: {
    name: 'extractObjectProperties extracts a named function expression that does not use this',
    input: `var o = {
  greet: function () {
    return "hi";
  }
};
log(o.greet());`,
  },

  objectReassigned: {
    name: 'extractObjectProperties leaves a reassigned binding alone',
    input: `var o = { foo: 1 };
o = { foo: 2 };
log(o.foo);`,
  },
  objectPropertyAssigned: {
    name: 'extractObjectProperties leaves an object alone when one of its properties is assigned',
    input: `var o = { foo: 1 };
o.foo = 2;
log(o.foo);`,
  },
  objectPropertyDeleted: {
    name: 'extractObjectProperties leaves an object alone when one of its properties is deleted',
    input: `var o = { foo: 1 };
delete o.foo;`,
  },
  objectPropertyUpdated: {
    name: 'extractObjectProperties leaves an object alone when one of its properties is updated',
    input: `var o = { foo: 1 };
o.foo++;`,
  },
  objectPassedAsArgument: {
    name: 'extractObjectProperties leaves an object alone when it is passed as an argument',
    input: `var o = { foo: 1 };
log(o);`,
  },
  objectAliased: {
    name: 'extractObjectProperties leaves an object alone when aliased to another binding',
    input: `var o = { foo: 1 };
var p = o;
log(p.foo);`,
  },
  objectMethodWithThis: {
    name: 'extractObjectProperties leaves an object alone when a method value references this',
    input: `var o = {
  m: function () {
    return this.x;
  }
};
log(o.m());`,
  },
  objectShorthandMethod: {
    name: 'extractObjectProperties leaves an object alone when it has shorthand method syntax',
    input: `var o = {
  m() {
    return 1;
  }
};
log(o.m());`,
  },
  objectGetter: {
    name: 'extractObjectProperties leaves an object alone when it has a getter',
    input: `var o = {
  get foo() {
    return 1;
  }
};
log(o.foo);`,
  },
  objectSpread: {
    name: 'extractObjectProperties leaves an object alone when it contains a spread element',
    input: `var o = { ...other, foo: 1 };
log(o.foo);`,
  },
  objectComputedDynamicKey: {
    name: 'extractObjectProperties leaves an object alone when a key is computed from a non-literal',
    input: `var o = { [k]: 1 };
log(o.foo);`,
  },
  objectMissingAccessKey: {
    name: 'extractObjectProperties leaves an object alone when an access key is not in the literal',
    input: `var o = { foo: 1 };
log(o.bar);`,
  },
  objectDynamicAccess: {
    name: 'extractObjectProperties leaves an object alone when accessed with a non-literal key',
    input: `var o = { foo: 1, bar: 2 };
log(o[k]);`,
  },
  objectDuplicateKey: {
    name: 'extractObjectProperties leaves an object alone when a property key appears twice',
    input: `var o = { foo: 1, foo: 2 };
log(o.foo);`,
  },
  objectSelfReference: {
    name: 'extractObjectProperties leaves an object alone when its init self-references the binding',
    input: `var o = { foo: 1, bar: o };
log(o.foo);`,
  },
  objectMultiDeclarator: {
    name: 'extractObjectProperties leaves a multi-declarator var alone',
    input: `var o = { foo: 1 }, p = 2;
log(o.foo);`,
  },
  objectInForIn: {
    name: 'extractObjectProperties leaves an object alone when used as the LHS of a for-in iteration',
    input: `var o = { foo: 1 };
for (o.foo in src) {
  log(o.foo);
}`,
  },

  arrayUnusedIndex: {
    name: 'extractObjectProperties keeps a per-index var even when the index is never read',
    input: `var arr = [side1(), side2(), side3()];
log(arr[0]);`,
  },
  arrayStringIndex: {
    name: 'extractObjectProperties accepts string-literal index access on an array',
    input: `var arr = [10, 20];
log(arr["0"], arr["1"]);`,
  },

  arrayHole: {
    name: 'extractObjectProperties leaves an array alone when it contains a hole',
    input: `var arr = [1, , 3];
log(arr[0]);`,
  },
  arraySpread: {
    name: 'extractObjectProperties leaves an array alone when it contains a spread element',
    input: `var arr = [1, ...rest];
log(arr[0]);`,
  },
  arrayLengthRead: {
    name: 'extractObjectProperties leaves an array alone when its length is read',
    input: `var arr = [1, 2, 3];
log(arr.length);`,
  },
  arrayDynamicIndex: {
    name: 'extractObjectProperties leaves an array alone when accessed with a non-literal index',
    input: `var arr = [1, 2, 3];
log(arr[i]);`,
  },
  arrayOutOfBounds: {
    name: 'extractObjectProperties leaves an array alone when an access index exceeds the literal',
    input: `var arr = [1, 2];
log(arr[5]);`,
  },

  collidesWithExistingBinding: {
    name: 'extractObjectProperties picks a uid when the property name collides with an existing binding',
    input: `var foo = "outer";
var o = { foo: 1 };
log(foo, o.foo);`,
  },
  duplicateKeysAcrossExtractions: {
    name: 'extractObjectProperties picks a uid when a downstream extraction would shadow a previous one',
    input: `var a = { foo: 1 };
var b = { foo: 2 };
log(a.foo, b.foo);`,
  },
  arrayCollidesWithExistingBinding: {
    name: 'extractObjectProperties picks a uid when an array index name collides with an existing binding',
    input: `var arr0 = "outer";
var arr = [10, 20];
log(arr0, arr[0], arr[1]);`,
  },
  invalidIdentifierKey: {
    name: 'extractObjectProperties picks a uid when the property key is not a valid identifier',
    input: `var o = { "foo-bar": 1 };
log(o["foo-bar"]);`,
  },

  nestedObject: {
    name: 'extractObjectProperties unwraps a nested object literal in a single pass',
    input: `var o = { a: { x: 1 } };
log(o.a.x);`,
  },

  constBinding: {
    name: 'extractObjectProperties extracts a const-bound object literal, preserving the kind',
    input: `const o = { foo: 1 };
log(o.foo);`,
  },
  letBinding: {
    name: 'extractObjectProperties extracts a let-bound array literal, preserving the kind',
    input: `let arr = [1, 2];
log(arr[0]);`,
  },
})

test(cases.specObject.name, () => {
  const out = run(cases.specObject.input, extractObjectProperties)
  expect(out).toContain('var foo = 1')
  expect(out).toContain('var bar = 2')
  expect(out).toContain('func(foo, bar)')
  expect(out).not.toContain('o.foo')
  expect(out).not.toContain('o.bar')
})

test(cases.specObjectFunctions.name, () => {
  const out = run(cases.specObjectFunctions.input, extractObjectProperties)
  expect(out).toContain('var isString =')
  expect(out).toContain('var isBoolean =')
  expect(out).toContain('if (isString("foo"))')
  expect(out).not.toContain('utils.isString')
})

test(cases.specArray.name, () => {
  const out = run(cases.specArray.input, extractObjectProperties)
  expect(out).toContain('var arr0 = 10')
  expect(out).toContain('var arr1 = 20')
  expect(out).toContain('var arr2 = 30')
  expect(out).toContain('log(arr0, arr2)')
  expect(out).not.toContain('arr[0]')
  expect(out).not.toContain('arr[2]')
})

test(cases.objectComputedStringKey.name, () => {
  const out = run(cases.objectComputedStringKey.input, extractObjectProperties)
  expect(out).toContain('var foo = 1')
  expect(out).toContain('var bar = 2')
  expect(out).toContain('func(foo, bar)')
})

test(cases.objectBracketAccess.name, () => {
  const out = run(cases.objectBracketAccess.input, extractObjectProperties)
  expect(out).toContain('var foo = 1')
  expect(out).toContain('func(foo)')
})

test(cases.objectMixedKey.name, () => {
  const out = run(cases.objectMixedKey.input, extractObjectProperties)
  expect(out).not.toContain('var o =')
  expect(out).not.toContain('o[0]')
})

test(cases.objectNamedFunctionExpressionNoThis.name, () => {
  const out = run(cases.objectNamedFunctionExpressionNoThis.input, extractObjectProperties)
  expect(out).toContain('var greet = function')
  expect(out).toContain('log(greet())')
})

const disqualifiers: (keyof typeof cases)[] = [
  'objectReassigned',
  'objectPropertyAssigned',
  'objectPropertyDeleted',
  'objectPropertyUpdated',
  'objectPassedAsArgument',
  'objectAliased',
  'objectMethodWithThis',
  'objectShorthandMethod',
  'objectGetter',
  'objectSpread',
  'objectComputedDynamicKey',
  'objectMissingAccessKey',
  'objectDynamicAccess',
  'objectDuplicateKey',
  'objectSelfReference',
  'objectMultiDeclarator',
  'objectInForIn',
  'arrayHole',
  'arraySpread',
  'arrayLengthRead',
  'arrayDynamicIndex',
  'arrayOutOfBounds',
]

for (const key of disqualifiers) {
  test(cases[key].name, () => {
    const out = run(cases[key].input, extractObjectProperties)
    expect(out).toMatch(/var (o|arr|p)\s*=\s*[\[{]/)
  })
}

test(cases.arrayUnusedIndex.name, () => {
  const out = run(cases.arrayUnusedIndex.input, extractObjectProperties)
  expect(out).toContain('var arr0 = side1()')
  expect(out).toContain('var arr1 = side2()')
  expect(out).toContain('var arr2 = side3()')
  expect(out).toContain('log(arr0)')
})

test(cases.arrayStringIndex.name, () => {
  const out = run(cases.arrayStringIndex.input, extractObjectProperties)
  expect(out).toContain('var arr0 = 10')
  expect(out).toContain('var arr1 = 20')
  expect(out).toContain('log(arr0, arr1)')
})

test(cases.collidesWithExistingBinding.name, () => {
  const out = run(cases.collidesWithExistingBinding.input, extractObjectProperties)
  expect(out).toContain('var foo = "outer"')
  expect(out).toMatch(/var _foo\d* = 1/)
  expect(out).not.toMatch(/var o\s*=\s*\{/)
})

test(cases.duplicateKeysAcrossExtractions.name, () => {
  const out = run(cases.duplicateKeysAcrossExtractions.input, extractObjectProperties)
  expect(out).toContain('var foo = 1')
  expect(out).toMatch(/var _foo\d* = 2/)
})

test(cases.arrayCollidesWithExistingBinding.name, () => {
  const out = run(cases.arrayCollidesWithExistingBinding.input, extractObjectProperties)
  expect(out).toContain('var arr0 = "outer"')
  expect(out).toMatch(/var _arr\d* = 10/)
  expect(out).toContain('var arr1 = 20')
})

test(cases.invalidIdentifierKey.name, () => {
  const out = run(cases.invalidIdentifierKey.input, extractObjectProperties)
  expect(out).not.toMatch(/var o\s*=\s*\{/)
  expect(out).toMatch(/var _property\d* = 1/)
})

test(cases.nestedObject.name, () => {
  const out = run(cases.nestedObject.input, extractObjectProperties)
  expect(out).toContain('var x = 1')
  expect(out).toContain('log(x)')
  expect(out).not.toContain('o.a')
})

test(cases.constBinding.name, () => {
  const out = run(cases.constBinding.input, extractObjectProperties)
  expect(out).toContain('const foo = 1')
  expect(out).toContain('log(foo)')
})

test(cases.letBinding.name, () => {
  const out = run(cases.letBinding.input, extractObjectProperties)
  expect(out).toContain('let arr0 = 1')
  expect(out).toContain('let arr1 = 2')
  expect(out).toContain('log(arr0)')
})

// Earlier rewrites can publish the same member path twice. Extraction must not
// revisit the detached path after its first replacement.
test('extractObjectProperties handles a member listed twice in referencePaths', () => {
  const ast = parse(`var o = { a: 1, b: 2 };\nlog(o.a, o.b);`, { sourceType: 'unambiguous' })
  traverse(ast, {
    Program(path) {
      const binding = path.scope.getBinding('o')!
      binding.referencePaths.push(binding.referencePaths[0]!)
      binding.references++
    },
  })

  expect(() => extractObjectProperties(ast)).not.toThrow()

  const out = generate(ast, { comments: false }).code
  expect(out).toContain('var a = 1')
  expect(out).toContain('var b = 2')
  expect(out).not.toMatch(/\bo\.[ab]\b/)

  const observed: unknown[] = []
  // oxlint-disable-next-line no-new-func
  new Function('log', out)((...args: unknown[]) => observed.push(args))
  expect(observed).toEqual([[1, 2]])
})

function traceExtract(src: string): { logs: unknown[]; threw: string | null } {
  const out = run(src, extractObjectProperties)
  return trace(out)
}

function expectExtractPreserves(src: string): void {
  expect(traceExtract(src)).toEqual(trace(src))
}

test('extractObjectProperties does not extract a __proto__ setter property', () => {
  expectExtractPreserves('var o = { __proto__: null }; log(o.__proto__);')
  expectExtractPreserves('var o = { __proto__: 5 }; log(typeof o.__proto__);')
})

test('extractObjectProperties does not drop a method-call receiver', () => {
  expectExtractPreserves(
    'function g() { return this.tag; } var o = { f: g, tag: "T" }; log(o.f());',
  )
  expectExtractPreserves(
    'var o = { f: Object.prototype.hasOwnProperty, a: 1 }; try { log(o.f("a")); } catch (error) { log(error.constructor.name); }',
  )
})

test('extractObjectProperties still extracts a this-free function called as a method', () => {
  const out = run('var o = { f: function () { return 5; } }; log(o.f());', extractObjectProperties)
  expect(out).not.toContain('o.f')
  expectExtractPreserves('var o = { f: function () { return 5; } }; log(o.f());')
})

test('extractObjectProperties does not extract a member inside a destructuring target', () => {
  expectExtractPreserves('const o = { x: 1 }; [o.x] = [5]; log(o.x);')
  expectExtractPreserves('const o = { x: 1 }; ({ y: o.x } = { y: 5 }); log(o.x);')
})

test('extractObjectProperties does not miss a computed-key this in a value function', () => {
  const src =
    'var o = { f: function () { return class { [this.k]() {} }; }, k: "zz" }; log(Object.getOwnPropertyNames(o.f().prototype).join(","));'
  expectExtractPreserves(src)
})

// A wrapper read before initialization throws, while an extracted binding read
// may return `undefined`.
test('extractObjectProperties bails on a read before the var declaration runs', () => {
  const src = 'try { log(o.a); } catch (e) { log("caught"); }\nvar o = { a: 1 };\nlog(o.a);'
  const out = run(src, extractObjectProperties)
  expect(out).toMatch(/var o\s*=\s*\{/)
  expectExtractPreserves(src)
})

test('extractObjectProperties bails on a reference reached before the declaration via a call', () => {
  const src =
    'function f() { return o.a; }\ntry { log(f()); } catch (e) { log("caught"); }\nvar o = { a: 1 };'
  const out = run(src, extractObjectProperties)
  expect(out).toMatch(/var o\s*=\s*\{/)
  expectExtractPreserves(src)
})

// An initializer in an untaken branch is not reached despite document order.
test('extractObjectProperties bails when the declaration sits in a never-taken branch', () => {
  const src = 'if (0) { var o = { a: 1 }; }\ntry { log(o.a); } catch (e) { log("caught"); }'
  const out = run(src, extractObjectProperties)
  expect(out).toMatch(/var o\s*=\s*\{/)
  expectExtractPreserves(src)
})

// Babel scopes lexical replacements for a `for` initializer inside an IIFE.
test('extractObjectProperties bails on a const for-init', () => {
  const src = 'var done = false;\nfor (const o = { a: 1 }; !done; ) { log(o.a); done = true; }'
  const out = run(src, extractObjectProperties)
  expect(out).toContain('for (const o = {')
  expect(out).not.toContain('function')
  expectExtractPreserves(src)
})

test('extractObjectProperties bails on a let for-init', () => {
  const src = 'var done = false;\nfor (let o = { a: 1 }; !done; ) { log(o.a); done = true; }'
  const out = run(src, extractObjectProperties)
  expect(out).toContain('for (let o = {')
  expect(out).not.toContain('function')
  expectExtractPreserves(src)
})

// `with` can shadow a synthesized declaration or rewritten reference.
test('extractObjectProperties bails when a reference sits inside a with block', () => {
  const src = 'var o = { a: 1 };\nvar w = { a: 99 };\nwith (w) { log(o.a); }'
  const out = run(src, extractObjectProperties)
  expect(out).toMatch(/var o\s*=\s*\{/)
  expectExtractPreserves(src)
})

test('extractObjectProperties bails when the declaration sits inside a with block', () => {
  const src = 'var w = {};\nwith (w) { var o = { a: 1 }; w.a = 99; log(o.a); }'
  const out = run(src, extractObjectProperties)
  expect(out).toMatch(/var o\s*=\s*\{/)
  expectExtractPreserves(src)
})

// A `var` initializer still hoists to the enclosing scope.
test('extractObjectProperties still extracts a var for-init', () => {
  const src = 'var done = false;\nfor (var o = { a: 1 }; !done; ) { log(o.a); done = true; }'
  const out = run(src, extractObjectProperties)
  expect(out).not.toMatch(/var o\s*=\s*\{/)
  expectExtractPreserves(src)
})
