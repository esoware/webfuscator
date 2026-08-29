import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'
import { expect, test } from 'vitest'

import type { ConcealStringsOptions, TransformContext } from '../../src/options'
import { concealStrings } from '../../src/transforms/conceal-strings'
import { defineCases, run, trace } from '../helpers'

const BASE_CONTEXT: TransformContext = { seed: 0, stringGeneratorMode: 'mangled' }
const CACHE_MISS_MARKER = 8675309

function apply(options: ConcealStringsOptions = {}, seed = 0) {
  return (ast: File): boolean =>
    concealStrings(ast, { ...BASE_CONTEXT, concealStrings: options, seed })
}

function transform(code: string, options: ConcealStringsOptions = {}, seed = 0): string {
  return run(code, apply(options, seed))
}

const cases = defineCases('conceal-strings', apply(), {
  programStrings: {
    name: 'concealStrings removes runtime plaintext and reconstructs the same values',
    input: `var first = "sensitive phrase";
var second = "another value";
log(first, second);`,
  },
  functionVault: {
    name: 'concealStrings shares its default vault with function bodies',
    input: `function greet(name) { return "Hello, " + name; }
log(greet("Ada"));`,
  },
  computedKeys: {
    name: 'concealStrings rebuilds computed object, class, and member keys',
    input: `var object = { ["secret"]: 4 };
class Box { ["read"]() { return object["secret"]; } }
log(new Box()["read"]());`,
  },
  conciseArrow: {
    name: 'concealStrings preserves concise arrows',
    input: `var suffix = (value) => value + "-suffix";
log(suffix("prefix"));`,
  },
})

for (const fixture of Object.values(cases)) {
  test(fixture.name, () => {
    const out = transform(fixture.input)
    expect(trace(out)).toEqual(trace(fixture.input))
  })
}

test('concealStrings emits an ordinary pool literal without retaining source phrases', () => {
  const out = transform(cases.programStrings.input)
  expect(out).not.toContain('sensitive phrase')
  expect(out).not.toContain('another value')
  expect(transform(`log("A");`, { cover: 'used' })).toContain('var _stringPool = "A"')
})

test('concealStrings emits only var declarations in its runtime', () => {
  const ast = parse(transform(`log("protected value");`), { sourceType: 'unambiguous' })
  const kinds = new Set<t.VariableDeclaration['kind']>()
  traverse(ast, {
    VariableDeclaration(path) {
      kinds.add(path.node.kind)
    },
  })
  expect(kinds).toEqual(new Set(['var']))
})

test('concealStrings regional cover fills nearby code-unit pages once', () => {
  const out = transform(`log("A", "\\u1234", "\\ud83d\\ude00");`)
  const pool = emittedPool(out)
  expect(pool).toHaveLength(4 * 0x100)
  expect(codeUnitCount(pool, 'B')).toBe(1)
  expect(codeUnitCount(pool, '\u1235')).toBe(1)
  expect(codeUnitCount(pool, '\uD83E')).toBe(1)
  expect(codeUnitCount(pool, '\uDE01')).toBe(1)
})

test('concealStrings used cover contains only source units', () => {
  const pool = emittedPool(transform(`log("aba");`, { cover: 'used' }))
  expect(pool).toHaveLength(2)
  expect(new Set(pool)).toEqual(new Set(['a', 'b']))
})

test('concealStrings full cover includes every UTF-16 code unit', () => {
  const pool = emittedPool(transform(`log("value");`, { cover: 'full' }))
  expect(pool).toHaveLength(0x10000)
  expect(pool).toContain('\u0000')
  expect(pool).toContain('\uD800')
  expect(pool).toContain('\uFFFF')
})

test('concealStrings preserves every UTF-16 code unit, including lone surrogates', () => {
  const input = `log("", "a", "\\ud800", "\\udc00", "😀", "e\\u0301", "A\\0B");`
  expect(trace(transform(input))).toEqual(trace(input))
})

test('concealStrings does not depend on mutable string or array methods', () => {
  const out = transform(`log("protected value");`)
  const stringMethods = String.prototype
  const arrayMethods = Array.prototype
  const fromCharCode = Object.getOwnPropertyDescriptor(String, 'fromCharCode')!
  const charCodeAt = Object.getOwnPropertyDescriptor(stringMethods, 'charCodeAt')!
  const join = Object.getOwnPropertyDescriptor(arrayMethods, 'join')!
  const observed: unknown[] = []
  try {
    const fail = (): never => {
      throw new Error('mutable built-in used')
    }
    Object.defineProperty(String, 'fromCharCode', { ...fromCharCode, value: fail })
    Object.defineProperty(stringMethods, 'charCodeAt', { ...charCodeAt, value: fail })
    Object.defineProperty(arrayMethods, 'join', { ...join, value: fail })
    new Function('log', out)((value: unknown) => observed.push(value))
  } finally {
    Object.defineProperty(String, 'fromCharCode', fromCharCode)
    Object.defineProperty(stringMethods, 'charCodeAt', charCodeAt)
    Object.defineProperty(arrayMethods, 'join', join)
  }
  expect(observed).toEqual(['protected value'])
})

test('concealStrings function scope creates independent vaults with one program pool', () => {
  const input = `function first() { return "first value"; }
function second() { return "second \u1234 value"; }
log(first(), second());`
  const out = transform(input, { cover: 'used', scope: 'function' })
  const pools = emittedPools(out)
  expect(trace(out)).toEqual(trace(input))
  expect(pools).toHaveLength(1)
  expect(emittedVaultCount(out)).toBe(2)
  expect(pools[0]!).toContain('f')
  expect(pools[0]!).toContain('\u1234')
})

test('concealStrings function caches survive calls without becoming program-shared', () => {
  const input = `function first() { return "shared value"; }
function second() { return "shared value"; }
log(first(), first(), second(), second());`
  const out = instrumentCacheMisses(transform(input, { cover: 'used', scope: 'function' }))
  expect(trace(out).logs.filter((value) => value === CACHE_MISS_MARKER)).toHaveLength(2)
})

test('concealStrings creates one private vault per evaluated function expression', () => {
  const input = `function make() {
  return function reveal() { return "shared value"; };
}
var first = make();
var second = make();
log(first(), first(), second(), second());`
  const out = instrumentCacheMisses(transform(input, { cover: 'used', scope: 'function' }))
  expect(trace(out).logs.filter((value) => value === CACHE_MISS_MARKER)).toHaveLength(2)
})

test('concealStrings creates one private vault per block function instance', () => {
  const input = `"use strict";
var functions = [];
for (var index = 0; index < 2; index++) {
  function reveal() { return "shared value"; }
  functions.push(reveal);
}
log(functions[0](), functions[0](), functions[1](), functions[1]());`
  const out = instrumentCacheMisses(transform(input, { cover: 'used', scope: 'function' }))
  expect(trace(out).logs.filter((value) => value === CACHE_MISS_MARKER)).toHaveLength(2)
})

test('concealStrings function closures preserve invocation and binding semantics', () => {
  const input = `log(hoisted(3));
function hoisted(count) {
  "use strict";
  if (count === 0) return this === undefined ? "done" : "wrong";
  return hoisted(count - 1);
}
function Receiver(prefix) {
  this.value = prefix + arguments[1] + (new.target === Receiver ? " constructed" : " called");
  this.read = () => this.value + " arrow";
}
var instance = new Receiver("a", "b");
function make(prefix) {
  return function nested(suffix) { return prefix + " nested " + suffix; };
}
var before;
try { lexical(); } catch (error) { before = error.name; }
let lexical = function named() { return "ready"; };
log(instance.read(), make("x")("y"), before, lexical());`
  expect(trace(transform(input, { cover: 'used', scope: 'function' }))).toEqual(trace(input))
})

test('concealStrings preserves home objects and class method semantics', () => {
  const input = `function makeObject() {
  return {
    __proto__: { read() { return "base"; } },
    read() { return super.read() + " object"; }
  };
}
class Base { read() { return "base"; } }
class Derived extends Base {
  constructor(value) { super(); this.value = value; }
  read() { return super.read() + this.value + " class"; }
}
log(makeObject().read(), new Derived(" derived").read());`
  expect(trace(transform(input, { cover: 'used', scope: 'function' }))).toEqual(trace(input))
})

test('concealStrings does not wrap method hosts with observable definition effects', () => {
  const input = `function probe() { return probe.caller === make; }
function make() {
  return {
    seen: probe(),
    read() { return "protected value"; }
  };
}
log(make().seen);`
  const out = transform(input, { cover: 'used', scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('protected value')
})

test('concealStrings keeps generated vault bindings visible through nested scopes', () => {
  const input = `function declared(_stringDecoder) {
  return "declared value" + _stringDecoder;
}
var reveal = function () {
  var _stringPool = "local pool";
  var _stringDecoder = function () { return "local decoder"; };
  return "protected value" + _stringPool + _stringDecoder();
};
log(declared(" argument"), reveal());`
  const out = transform(input, { scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(emittedPools(out)).toHaveLength(1)
})

test('concealStrings function scope preserves concise arrows with local vaults', () => {
  const input = `var suffix = (value) => value + "-suffix";
log(suffix("prefix"));`
  const out = transform(input, { cover: 'used', scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(emittedPools(out)).toHaveLength(1)
  expect(emittedVaultCount(out)).toBe(2)
})

test('concealStrings keeps parameter-default strings in the function closure vault', () => {
  const input = `function outer(prefix) {
  return function inner(value = "default value") {
    return value + " body value" + prefix;
  };
}
var inner = outer(" outer value");
log(inner());`
  const out = transform(input, { scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(emittedPools(out)).toHaveLength(1)
  expect(emittedVaultCount(out)).toBe(2)
})

test('concealStrings keeps a strict directive first in its function body', () => {
  const input = `function strictThis() {
  "use strict";
  return this === undefined ? "strict" : "sloppy";
}
log(strictThis());`
  const out = transform(input, { scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toMatch(/function strictThis\(\) \{\s*["']use strict["'];\s*return/u)
})

test('concealStrings can initialize a function vault before super without reading this', () => {
  const input = `class Base { constructor() { this.ready = true; } }
class Derived extends Base {
  constructor() {
    super();
    log("derived value", this.ready);
  }
}
new Derived();`
  expect(trace(transform(input, { scope: 'function' }))).toEqual(trace(input))
})

test('concealStrings does not create a separate vault for `with`', () => {
  const input = `var probes = 0;
var object = new Proxy({}, { has: function () { probes++; return false; } });
with (object) {
  log("inside with");
}
  log(probes);`
  const out = transform(input)
  expect(out).not.toContain('inside with')
  expect(out.indexOf('var _stringPool')).toBeLessThan(out.indexOf('var probes'))
})

test('concealStrings conceals runtime strings even where a direct eval can see them', () => {
  const input = `function reads(source) {
  log("visible value");
  return eval(source);
}
function plain() { return "concealed value"; }
log(reads('"evaluated value"'), plain());`
  const out = transform(input, { scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('visible value')
  expect(out).not.toContain('concealed value')
})

test('concealStrings leaves top-level module function subtrees unchanged for cyclic calls', () => {
  const input = `export function reveal(value = "default value") {
  function nested() { return "nested value"; }
  return value + " body value" + nested();
}`
  const out = transform(input, { cover: 'used', scope: 'function' })
  expect(out).toContain('default value')
  expect(out).toContain('nested value')
  expect(out).toContain('body value')
  expect(emittedPools(out)).toHaveLength(0)
})

test('concealStrings leaves grammar-only module strings and directives unchanged', () => {
  const input = `"use strict";
import value from "package-name";
export { value as "public-name" };
export * as "namespace-name" from "namespace-package";
log("runtime value");`
  const out = transform(input)
  expect(out).toContain('"use strict"')
  expect(out).toContain('"package-name"')
  expect(out).toContain('"public-name"')
  expect(out).toContain('"namespace-name"')
  expect(out).toContain('"namespace-package"')
  expect(out).not.toContain('runtime value')
})

test('concealStrings leaves a non-computed key unchanged when preparation refused it', () => {
  const input = `var parent = { inherited: 3 };
var object = { __proto__: parent };
log(object.inherited);`
  const out = transform(input)
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('__proto__')
})

test('concealStrings reuses one vault entry for equal literal sites', () => {
  const input = `log("same value", "same value");`
  const indexes = decoderIndexes(transform(input))
  expect(indexes).toHaveLength(2)
  expect(new Set(indexes).size).toBe(1)
})

test('concealStrings cache false omits retained plaintext slots', () => {
  const input = `for (var index = 0; index < 2; index++) log("repeated value");`
  const cached = transform(input)
  const uncached = transform(input, { cache: false })
  expect(trace(cached)).toEqual(trace(input))
  expect(trace(uncached)).toEqual(trace(input))
  expect(cached).toContain('[null]')
  expect(uncached).not.toContain('null')
})

test('concealStrings is deterministic per seed and varies its representation across seeds', () => {
  const input = `log("first protected value", "second protected value");`
  expect(transform(input, {}, 7)).toBe(transform(input, {}, 7))
  expect(transform(input, {}, 7)).not.toBe(transform(input, {}, 8))
})

test('concealStrings emits one key-and-step position mask', () => {
  const shape = emittedMaskShape(transform(`log("protected value");`))
  expect(shape).toBe('&(+(value,*(value,value)),number)')
})

test('concealStrings recovers strings through varied mask keys and steps', () => {
  const input = `log("ASCII", "\\u1234", "\\ud800", "\\ud83d\\ude00");`
  const expected = trace(input)
  for (let seed = 0; seed < 32; seed++) {
    expect(trace(transform(input, {}, seed))).toEqual(expected)
  }
})

test('concealStrings reports whether it changed the AST', () => {
  const unchanged = parse(`"use strict"; var value = 1;`, { sourceType: 'unambiguous' })
  const changed = parse(`var value = "runtime";`, { sourceType: 'unambiguous' })
  expect(concealStrings(unchanged, BASE_CONTEXT)).toBe(false)
  expect(concealStrings(changed, BASE_CONTEXT)).toBe(true)
})

test('concealStrings rejects malformed options at the caller boundary', () => {
  const ast = parse(`var value = "runtime";`, { sourceType: 'unambiguous' })
  const invalidCache = { cache: 'yes' } as unknown as ConcealStringsOptions
  const invalidCover = { cover: 'ascii' } as unknown as ConcealStringsOptions
  const invalidScope = { scope: 'block' } as unknown as ConcealStringsOptions
  expect(() => concealStrings(ast, { ...BASE_CONTEXT, concealStrings: invalidCache })).toThrow(
    /cache must be a boolean/u,
  )
  expect(() => concealStrings(ast, { ...BASE_CONTEXT, concealStrings: invalidCover })).toThrow(
    /cover must be/u,
  )
  expect(() => concealStrings(ast, { ...BASE_CONTEXT, concealStrings: invalidScope })).toThrow(
    /scope must be/u,
  )
})

function instrumentCacheMisses(code: string): string {
  const ast = parse(code, { sourceType: 'unambiguous' })
  traverse(ast, {
    VariableDeclarator(path) {
      if (
        !t.isIdentifier(path.node.id) ||
        !path.node.id.name.includes('stringDecoder') ||
        !t.isFunctionExpression(path.node.init)
      ) {
        return
      }
      const guardIndex = path.node.init.body.body.findIndex((statement) =>
        t.isIfStatement(statement),
      )
      if (guardIndex === -1) {
        return
      }
      path.node.init.body.body.splice(
        guardIndex + 1,
        0,
        t.expressionStatement(
          t.callExpression(t.identifier('log'), [t.numericLiteral(CACHE_MISS_MARKER)]),
        ),
      )
    },
  })
  return generate(ast, { comments: false, shouldPrintComment: () => false }).code
}

function decoderIndexes(code: string): number[] {
  const ast = parse(code, { sourceType: 'unambiguous' })
  const indexes: number[] = []
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee
      const argument = path.node.arguments[0]
      if (
        t.isIdentifier(callee) &&
        callee.name.includes('stringDecoder') &&
        t.isNumericLiteral(argument)
      ) {
        indexes.push(argument.value)
      }
    },
  })
  return indexes
}

function emittedPool(code: string): string {
  return emittedPools(code)[0]!
}

function emittedPools(code: string): string[] {
  const ast = parse(code, { sourceType: 'unambiguous' })
  const pools: string[] = []
  traverse(ast, {
    VariableDeclarator(path) {
      if (
        t.isIdentifier(path.node.id) &&
        path.node.id.name.includes('stringPool') &&
        t.isStringLiteral(path.node.init)
      ) {
        pools.push(path.node.init.value)
      }
    },
  })
  return pools
}

function emittedVaultCount(code: string): number {
  const ast = parse(code, { sourceType: 'unambiguous' })
  let count = 0
  traverse(ast, {
    VariableDeclarator(path) {
      if (t.isIdentifier(path.node.id) && path.node.id.name.includes('stringMetadata')) {
        count++
      }
    },
  })
  return count
}

function codeUnitCount(value: string, expected: string): number {
  let count = 0
  let index = 0
  while (index < value.length) {
    if (value[index] === expected) {
      count++
    }
    index++
  }
  return count
}

function emittedMaskShape(code: string): string {
  const ast = parse(code, { sourceType: 'unambiguous' })
  let expression: t.Expression | undefined
  traverse(ast, {
    VariableDeclarator(path) {
      if (
        t.isIdentifier(path.node.id) &&
        path.node.id.name.includes('stringMask') &&
        t.isExpression(path.node.init)
      ) {
        expression = path.node.init
        path.stop()
      }
    },
  })
  return operatorShape(expression!)
}

function operatorShape(node: t.Node): string {
  if (t.isBinaryExpression(node)) {
    return `${node.operator}(${operatorShape(node.left)},${operatorShape(node.right)})`
  }
  return t.isNumericLiteral(node) ? 'number' : 'value'
}
