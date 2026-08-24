import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'
import { expect, test } from 'vitest'

import type { ConcealStringsOptions, TransformContext } from '../../src/options'
import { concealStrings } from '../../src/transforms/conceal-strings'
import { defineCases, run, trace } from '../helpers'

const BASE_CONTEXT: TransformContext = { seed: 0, stringGeneratorMode: 'mangled' }

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
  expect(transform(`log("A");`, { cover: 'used' })).toContain('const _stringPool = "A"')
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

test('concealStrings function scope creates independent vaults with the same whole-program pool', () => {
  const input = `function first() { return "first value"; }
function second() { return "second \u1234 value"; }
log(first(), second());`
  const out = transform(input, { cover: 'used', scope: 'function' })
  const pools = emittedPools(out)
  expect(trace(out)).toEqual(trace(input))
  expect(pools).toHaveLength(2)
  expect(new Set(pools).size).toBe(1)
  expect(pools[0]!).toContain('f')
  expect(pools[0]!).toContain('\u1234')
})

test('concealStrings function scope normalizes concise arrows for local vaults', () => {
  const input = `var suffix = (value) => value + "-suffix";
log(suffix("prefix"));`
  const out = transform(input, { cover: 'used', scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(new Set(emittedPools(out)).size).toBe(1)
})

test('concealStrings keeps parameter-default strings in the surrounding vault', () => {
  const input = `function outer(prefix) {
  return function inner(value = "default value") {
    return value + " body value" + prefix;
  };
}
var inner = outer(" outer value");
log(inner());`
  const out = transform(input, { scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(emittedPools(out)).toHaveLength(3)
  expect(new Set(emittedPools(out)).size).toBe(1)
})

test('concealStrings keeps a strict directive first in its function body', () => {
  const input = `function strictThis() {
  "use strict";
  return this === undefined ? "strict" : "sloppy";
}
log(strictThis());`
  const out = transform(input, { scope: 'function' })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toMatch(/function strictThis\(\) \{\s*["']use strict["'];\s*const/u)
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

test('concealStrings shields decoder bindings from a with-object environment', () => {
  const input = `var probes = 0;
var object = new Proxy({}, { has: function () { probes++; return false; } });
with (object) {
  log("inside with");
}
log(probes);`
  expect(trace(transform(input))).toEqual(trace(input))
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

test('concealStrings can keep equal literal sites in separate entries', () => {
  const input = `log("same value", "same value");`
  const deduplicated = decoderIndexes(transform(input))
  const separate = decoderIndexes(transform(input, { deduplicate: false }))
  expect(separate).toHaveLength(2)
  expect(new Set(separate).size).toBe(2)
  expect(deduplicated).toHaveLength(2)
  expect(new Set(deduplicated).size).toBe(1)
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
  const invalidDeduplication = { deduplicate: 1 } as unknown as ConcealStringsOptions
  const invalidScope = { scope: 'block' } as unknown as ConcealStringsOptions
  expect(() => concealStrings(ast, { ...BASE_CONTEXT, concealStrings: invalidCache })).toThrow(
    /cache must be a boolean/u,
  )
  expect(() => concealStrings(ast, { ...BASE_CONTEXT, concealStrings: invalidCover })).toThrow(
    /cover must be/u,
  )
  expect(() =>
    concealStrings(ast, { ...BASE_CONTEXT, concealStrings: invalidDeduplication }),
  ).toThrow(/deduplicate must be a boolean/u)
  expect(() => concealStrings(ast, { ...BASE_CONTEXT, concealStrings: invalidScope })).toThrow(
    /scope must be/u,
  )
})

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
