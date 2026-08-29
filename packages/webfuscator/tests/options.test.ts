import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { expect, test } from 'vitest'

import { obfuscate } from '../src/index'
import type { ObfuscatorOptions } from '../src/index'
import { obfuscateAll } from './obfuscator-helpers'

function evalProgram(code: string, harness?: Record<string, unknown>): unknown {
  const keys = harness ? Object.keys(harness) : []
  const values = harness ? keys.map((k) => harness[k]) : []
  return new Function(...keys, code).call(null, ...values)
}

const KEEP_RUNTIME_STRINGS = { concealStrings: false } as const

test('obfuscate omitting transforms runs no configurable transforms', () => {
  const src = `function helper(x) { return x + 1; } log(helper(5));`
  const defaultOut = obfuscate(src)
  const explicitOut = obfuscate(src, { transforms: {} })
  expect(defaultOut).toBe(explicitOut)
  expect(defaultOut).toContain('function helper')
})

test('obfuscate runs preparation when transforms are omitted', () => {
  const out = obfuscate(`const value = object.property;`)
  expect(out).toContain('const value')
  expect(out).toContain('object["property"]')
})

test('obfuscate leaves class fields intact during preparation', () => {
  const source = `class Box { value = 1; static count = 2; }
log(new Box().value, Box.count);`
  const out = obfuscate(source)
  const evaluate = (code: string): unknown[] => {
    const calls: unknown[] = []
    evalProgram(code, { log: (...values: unknown[]) => calls.push(values) })
    return calls
  }

  expect(evaluate(out)).toEqual(evaluate(source))
  expect(out).toContain('value = 1')
  expect(out).toContain('static count = 2')
  expect(out).not.toContain('Object.defineProperty')
})

test('obfuscate minify uses Babel minified output without changing behavior', () => {
  const src = `function add(a, b) { return a + b; } log(add(2, 3));`
  const formatted = obfuscate(src)
  const explicitFormatted = obfuscate(src, { minify: false })
  const minified = obfuscate(src, { minify: true })
  const evaluate = (code: string): unknown[] => {
    const calls: unknown[] = []
    evalProgram(code, { log: (value: unknown) => calls.push(value) })
    return calls
  }

  expect(explicitFormatted).toBe(formatted)
  expect(formatted).toContain('\n')
  expect(minified).not.toContain('\n')
  expect(minified.length).toBeLessThan(formatted.length)
  expect(evaluate(formatted)).toEqual([5])
  expect(evaluate(minified)).toEqual([5])
})

test('obfuscateAll with dropConsole set to false keeps console.* statements', () => {
  const src = `console.log("kept"); var x = 42; log(x);`
  const withTransform = obfuscateAll(src)
  const withoutTransform = obfuscateAll(src, {
    transforms: { ...KEEP_RUNTIME_STRINGS, dropConsole: false },
  })
  // Preparation changes dot access regardless of this transform toggle.
  expect(withTransform).not.toContain('console')
  expect(withoutTransform).toContain('console')
  expect(withoutTransform).toContain('"kept"')
})

test('obfuscateAll with dropDebugger set to false keeps debugger statements', () => {
  const src = `function f() { debugger; return 1; } log(f());`
  const withTransform = obfuscateAll(src)
  const withoutTransform = obfuscateAll(src, { transforms: { dropDebugger: false } })
  expect(withTransform).not.toContain('debugger')
  expect(withoutTransform).toContain('debugger')
})

test('obfuscateAll with foldConstants set to false leaves arithmetic literals untouched', () => {
  const src = `var x = 1 + 2 + 3; log(x);`
  const withTransform = obfuscateAll(src, { transforms: { numbersToStrings: false } })
  // Single-use temporary collapse can perform the same constant propagation.
  const withoutTransform = obfuscateAll(src, {
    transforms: { foldConstants: false, collapseSingleUseTemps: false, numbersToStrings: false },
  })
  expect(withTransform).toContain('log(6)')
  expect(withoutTransform).not.toContain('log(6)')
  expect(withoutTransform).toMatch(/1\s*\+\s*2/)
})

test('obfuscateAll with inlineFunctions set to false keeps the function declaration', () => {
  const src = `function helper(a, b) { return a + b; } log(helper(2, 3));`
  const withTransform = obfuscateAll(src)
  const withoutTransform = obfuscateAll(src, {
    transforms: {
      inlineFunctions: false,
      collapseSingleUseFunctions: false,
      renameIdentifiers: false,
      functionDeclarationToExpression: false,
    },
  })
  expect(withTransform).not.toContain('function helper')
  expect(withoutTransform).toContain('function helper')
  expect(withoutTransform).toMatch(/helper\s*\(/)
})

test('obfuscateAll with switchToIf set to false keeps the switch statement', () => {
  const src = `function pick(x) {
    switch (x) {
      case 1: return 'a';
      case 2: return 'b';
      default: return 'd';
    }
  }
  log(pick(2));`
  const withTransform = obfuscateAll(src)
  const withoutTransform = obfuscateAll(src, { transforms: { switchToIf: false } })
  expect(withTransform).not.toContain('switch (')
  expect(withoutTransform).toContain('switch (')
})

test('obfuscateAll with arrowToFunction set to false keeps arrow expressions', () => {
  const src = `var f = (x) => x * 2; log(f(3));`
  const withTransform = obfuscateAll(src)
  const withoutTransform = obfuscateAll(src, { transforms: { arrowToFunction: false } })
  expect(withTransform).not.toContain('=>')
  expect(withoutTransform).toContain('=>')
})

test('obfuscateAll with optionalChainingToTernary set to false keeps the optional chain', () => {
  const src = `function getX(o) { return o?.a?.b; } log(getX({a: {b: 7}}));`
  const withTransform = obfuscateAll(src)
  const withoutTransform = obfuscateAll(src, {
    transforms: { optionalChainingToTernary: false },
  })
  expect(withTransform).not.toContain('?.')
  expect(withoutTransform).toContain('?.')
})

test('obfuscateAll with yodifyConditions set to false leaves operand order intact', () => {
  const src = `var x = read(); if (x === 1) emit(); else other();`
  const withTransform = obfuscateAll(src, { transforms: { numbersToStrings: false } })
  const withoutTransform = obfuscateAll(src, {
    transforms: { yodifyConditions: false, numbersToStrings: false },
  })
  expect(withTransform).toContain('1 ===')
  expect(withoutTransform).toContain('=== 1')
})

test('obfuscateAll with extractObjectProperties set to false keeps the wrapper variable', () => {
  const src = `var u = { f: function () { return 5; } };
log(u.f());
log(u.f());`
  const withTransform = obfuscateAll(src, { transforms: { renameIdentifiers: false } })
  const withoutTransform = obfuscateAll(src, {
    transforms: {
      extractObjectProperties: false,
      inlineFunctions: false,
      collapseSingleUseTemps: false,
      renameIdentifiers: false,
      hoistVariables: false,
    },
  })
  const hasWrapper = (code: string): boolean => {
    let found = false
    t.traverseFast(parse(code, { sourceType: 'unambiguous' }), (node) => {
      if (t.isVariableDeclarator(node) && t.isIdentifier(node.id, { name: 'u' })) {
        found = true
      }
    })
    return found
  }
  expect(hasWrapper(withoutTransform)).toBe(true)
  expect(hasWrapper(withTransform)).toBe(false)
})

test('obfuscateAll with the fixed-point group set to false still produces a valid program', () => {
  const src = `function f(x) { return x + 1; } log(f(5));`
  const opts: ObfuscatorOptions = {
    transforms: {
      foldConstants: false,
      foldBuiltinMethods: false,
      extractObjectProperties: false,
      inlineFunctions: false,
      collapseSingleUseFunctions: false,
      removeUnreachableCode: false,
      removeUnusedCode: false,
      removeAnonymousFunctionNames: false,
      collapseSingleUseTemps: false,
      renameIdentifiers: false,
      functionDeclarationToExpression: false,
    },
  }
  const out = obfuscateAll(src, opts)
  expect(out).toContain('function f')
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([6])
})

test('obfuscateAll preserves behavior when individual transform entries are false', () => {
  const src = `function add(a, b) { return a + b; }
function pick(x) {
  switch (x) {
    case 1: return 'a';
    case 2: return 'b';
    default: return 'd';
  }
}
var v = add(1, 2);
log(v);
log(pick(1));
log(pick(99));`
  const trial = (opts?: ObfuscatorOptions): unknown[] => {
    const out = obfuscateAll(src, opts)
    const calls: unknown[] = []
    evalProgram(out, { log: (v: unknown) => calls.push(v) })
    return calls
  }
  const baseline = trial()
  expect(baseline).toEqual([3, 'a', 'd'])
  expect(trial({ transforms: { inlineFunctions: false } })).toEqual([3, 'a', 'd'])
  expect(trial({ transforms: { switchToIf: false } })).toEqual([3, 'a', 'd'])
  expect(trial({ transforms: { foldConstants: false } })).toEqual([3, 'a', 'd'])
  expect(trial({ transforms: { yodifyConditions: false } })).toEqual([3, 'a', 'd'])
})

test('obfuscateAll passing true for a transform matches its preset', () => {
  const src = `var x = 1 + 2; log(x);`
  const preset = obfuscateAll(src)
  const explicitTrue = obfuscateAll(src, { transforms: { foldConstants: true } })
  expect(preset).toBe(explicitTrue)
})

test('obfuscate runs concealStrings through its public boolean and object entries', () => {
  const source = `function first() { return "first private value"; }
function second() { return "second private value"; }
log(first(), second());`
  const shared = obfuscate(source, { transforms: { concealStrings: true } })
  const scoped = obfuscate(source, {
    transforms: { concealStrings: { cover: 'used', scope: 'function' } },
  })
  const evaluate = (code: string): unknown[] => {
    const calls: unknown[] = []
    evalProgram(code, { log: (...values: unknown[]) => calls.push(values) })
    return calls
  }

  expect(evaluate(shared)).toEqual(evaluate(source))
  expect(evaluate(scoped)).toEqual(evaluate(source))
  expect(shared).not.toContain('first private value')
  expect(scoped).not.toContain('second private value')
  expect(shared.match(/var _stringPool/gu)).toHaveLength(1)
  expect(scoped.match(/var _stringPool/gu)).toHaveLength(1)
})

// Set inlining to false so the bindings under name-style tests survive.
const RENAME_FIXTURE = `function add(value, multiplier) {
  var scaled = value * multiplier;
  return scaled;
}
var first = read();
var second = read();
log(add(first, second));`

// Keep the fixture's declaration form visible to name-style assertions.
const NO_INLINE = {
  inlineFunctions: false,
  collapseSingleUseFunctions: false,
  collapseSingleUseTemps: false,
  foldConstants: false,
  functionDeclarationToExpression: false,
} as const

test('obfuscate global stringGeneratorMode: hexadecimal renames bindings to _0x... names', () => {
  const out = obfuscateAll(RENAME_FIXTURE, {
    stringGeneratorMode: 'hexadecimal',
    transforms: NO_INLINE,
  })
  expect(out).toMatch(/function _0x[0-9a-f]+\(_0x[0-9a-f]+, _0x[0-9a-f]+\)/)
})

test('obfuscate global stringGeneratorMode: number renames bindings to var_N names', () => {
  const out = obfuscateAll(RENAME_FIXTURE, { stringGeneratorMode: 'number', transforms: NO_INLINE })
  expect(out).toMatch(/function var_\d+\(var_\d+, var_\d+\)/)
})

test('obfuscate global stringGeneratorMode: randomized produces valid-identifier names', () => {
  const out = obfuscateAll(RENAME_FIXTURE, {
    stringGeneratorMode: 'randomized',
    transforms: NO_INLINE,
  })
  expect(out).toMatch(/function [a-zA-Z_$][a-zA-Z_$0-9]*\(/)
})

test('obfuscate per-transform override: renameIdentifiers picks its own style over the global', () => {
  const out = obfuscateAll(RENAME_FIXTURE, {
    stringGeneratorMode: 'number',
    transforms: { ...NO_INLINE, renameIdentifiers: { stringGeneratorMode: 'hexadecimal' } },
  })
  expect(out).toMatch(/function _0x[0-9a-f]+\(/)
  expect(out).not.toMatch(/function var_\d+\(/)
})

test('obfuscate per-transform override: object form runs the transform', () => {
  const out = obfuscateAll(RENAME_FIXTURE, {
    transforms: { ...NO_INLINE, renameIdentifiers: { stringGeneratorMode: 'hexadecimal' } },
  })
  expect(out).toMatch(/function _0x[0-9a-f]+\(/)
})

test('obfuscate per-transform override: specialsToStrings can use number style for its string contents', () => {
  const src = `var x = undefined; log(x);`
  const out = obfuscateAll(src, {
    transforms: {
      ...NO_INLINE,
      ...KEEP_RUNTIME_STRINGS,
      renameIdentifiers: false,
      specialsToStrings: { stringGeneratorMode: 'number' },
    },
  })
  expect(out).toMatch(/void "var_\d+"/)
})

test('obfuscate global stringGeneratorMode: array mixes the supplied modes in the output', () => {
  const src = `function f(a, b, c, d, e, f1, g, h, i, j) {
    return a + b + c + d + e + f1 + g + h + i + j;
  }
  log(f(read(), read(), read(), read(), read(), read(), read(), read(), read(), read()));`
  const out = obfuscateAll(src, {
    stringGeneratorMode: ['hexadecimal', 'number'],
    transforms: NO_INLINE,
  })
  expect(out).toMatch(/_0x[0-9a-f]+/)
  expect(out).toMatch(/var_\d+/)
})

test('obfuscate per-transform `false` prevents that transform from running', () => {
  const out = obfuscateAll(RENAME_FIXTURE, {
    transforms: {
      ...NO_INLINE,
      renameIdentifiers: false,
      specialsToStrings: { stringGeneratorMode: 'hexadecimal' },
    },
  })
  expect(out).toContain('add')
  expect(out).toContain('value')
})

const PROPERTY_FIXTURE = `var object = read();
object.secret_ = read();
log(object.secret_);`

test('obfuscate does not run property mangling when omitted', () => {
  const omitted = obfuscateAll(PROPERTY_FIXTURE, { transforms: KEEP_RUNTIME_STRINGS })
  const explicitFalse = obfuscateAll(PROPERTY_FIXTURE, {
    transforms: { ...KEEP_RUNTIME_STRINGS, mangleProperties: false },
  })
  expect(omitted).toBe(explicitFalse)
  expect(omitted).toContain('secret_')
})

test('obfuscate runs mangleProperties with true', () => {
  const out = obfuscateAll(PROPERTY_FIXTURE, {
    transforms: { ...KEEP_RUNTIME_STRINGS, mangleProperties: true },
  })
  expect(out).not.toContain('secret_')
})

test('obfuscate mangleProperties inherits the global stringGeneratorMode', () => {
  const out = obfuscateAll(PROPERTY_FIXTURE, {
    stringGeneratorMode: 'number',
    transforms: { ...KEEP_RUNTIME_STRINGS, mangleProperties: true },
  })
  expect(out).toMatch(/\["var_\d+"\]/)
})

test('obfuscate mangleProperties can override the global stringGeneratorMode', () => {
  const out = obfuscateAll(PROPERTY_FIXTURE, {
    stringGeneratorMode: 'hexadecimal',
    transforms: {
      ...KEEP_RUNTIME_STRINGS,
      mangleProperties: { stringGeneratorMode: 'number' },
    },
  })
  expect(out).toMatch(/\["var_\d+"\]/)
  expect(out).not.toMatch(/\["_0x[0-9a-f]+"\]/)
})

test('obfuscate mangleProperties custom nameGenerator takes precedence over string modes', () => {
  const out = obfuscateAll(PROPERTY_FIXTURE, {
    stringGeneratorMode: 'number',
    transforms: {
      ...KEEP_RUNTIME_STRINGS,
      mangleProperties: {
        nameGenerator: () => 'customProperty',
        stringGeneratorMode: 'hexadecimal',
      },
    },
  })
  expect(out).toContain('["customProperty"]')
  expect(out).not.toContain('secret_')
})

test('obfuscate mangleProperties applies regex inclusion and reserved exclusion together', () => {
  const src = `var object = read();
object.public = read();
object.private_ = read();
object.keep_ = read();
log(object.public, object.private_, object.keep_);`
  const out = obfuscateAll(src, {
    transforms: {
      ...KEEP_RUNTIME_STRINGS,
      mangleProperties: {
        builtins: true,
        nameGenerator: () => 'renamed',
        regex: /_$/,
        reserved: ['keep_'],
      },
    },
  })
  expect(out).toContain('["public"]')
  expect(out).toContain('["keep_"]')
  expect(out).toContain('["renamed"]')
  expect(out).not.toContain('private_')
})

test('obfuscate keeps property mappings aligned through later pipeline simplifications', () => {
  const src = `const key = "secret_";
class Box { secret_ = 4; }
var box = new Box();
var { secret_: value } = box;
log(box[\`secret_\`], box["sec" + "ret_"], box[key], value);`
  const logs: unknown[] = []
  const out = obfuscateAll(src, {
    transforms: {
      ...KEEP_RUNTIME_STRINGS,
      mangleProperties: {
        builtins: true,
        nameGenerator: () => 'renamed',
        regex: /_$/,
      },
    },
  })
  evalProgram(out, { log: (...values: unknown[]) => logs.push(values) })
  expect(logs).toEqual([[4, 4, 4, 4]])
  expect(out).not.toContain('secret_')
})
