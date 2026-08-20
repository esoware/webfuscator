import { expect, test } from 'vitest'

import { obfuscate as obfuscateWithDefaults } from 'src/index'
import type { ObfuscatorOptions } from 'src/index'

import { obfuscateWithTransformPipeline as obfuscate } from './obfuscator-helpers'

function evalProgram(code: string, harness?: Record<string, unknown>): unknown {
  const keys = harness ? Object.keys(harness) : []
  const values = harness ? keys.map((k) => harness[k]) : []
  return new Function(...keys, code).call(null, ...values)
}

test('obfuscate omitting transforms runs no configurable transforms', () => {
  const src = `function helper(x) { return x + 1; } log(helper(5));`
  const defaultOut = obfuscateWithDefaults(src)
  const explicitOut = obfuscateWithDefaults(src, { transforms: {} })
  expect(defaultOut).toBe(explicitOut)
  expect(defaultOut).toContain('function helper')
})

test('obfuscate keeps preparation enabled when transforms are omitted', () => {
  const out = obfuscateWithDefaults(`const value = object.property;`)
  expect(out).toContain('const value')
  expect(out).toContain('object["property"]')
})

test('obfuscate leaves class fields intact during preparation', () => {
  const source = `class Box { value = 1; static count = 2; }
log(new Box().value, Box.count);`
  const out = obfuscateWithDefaults(source)
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

test('obfuscate minify selects Babel minified output without changing behavior', () => {
  const src = `function add(a, b) { return a + b; } log(add(2, 3));`
  const formatted = obfuscateWithDefaults(src)
  const explicitFormatted = obfuscateWithDefaults(src, { minify: false })
  const minified = obfuscateWithDefaults(src, { minify: true })
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

test('obfuscate with dropConsole disabled keeps console.* statements', () => {
  const src = `console.log("kept"); var x = 42; log(x);`
  const enabled = obfuscate(src)
  const disabled = obfuscate(src, { transforms: { dropConsole: false } })
  // Preparation changes dot access regardless of this transform toggle.
  expect(enabled).not.toContain('console')
  expect(disabled).toContain('console')
  expect(disabled).toContain('"kept"')
})

test('obfuscate with dropDebugger disabled keeps debugger statements', () => {
  const src = `function f() { debugger; return 1; } log(f());`
  const enabled = obfuscate(src)
  const disabled = obfuscate(src, { transforms: { dropDebugger: false } })
  expect(enabled).not.toContain('debugger')
  expect(disabled).toContain('debugger')
})

test('obfuscate with foldConstants disabled leaves arithmetic literals untouched', () => {
  const src = `var x = 1 + 2 + 3; log(x);`
  const enabled = obfuscate(src, { transforms: { numbersToStrings: false } })
  // Single-use temporary collapse can perform the same constant propagation.
  const disabled = obfuscate(src, {
    transforms: { foldConstants: false, collapseSingleUseTemps: false, numbersToStrings: false },
  })
  expect(enabled).toContain('log(6)')
  expect(disabled).not.toContain('log(6)')
  expect(disabled).toMatch(/1\s*\+\s*2/)
})

test('obfuscate with inlineFunctions disabled keeps the function declaration', () => {
  const src = `function helper(a, b) { return a + b; } log(helper(2, 3));`
  const enabled = obfuscate(src)
  const disabled = obfuscate(src, {
    transforms: {
      inlineFunctions: false,
      renameIdentifiers: false,
      functionDeclarationToExpression: false,
    },
  })
  expect(enabled).not.toContain('function helper')
  expect(disabled).toContain('function helper')
  expect(disabled).toMatch(/helper\s*\(/)
})

test('obfuscate with switchToIf disabled keeps the switch statement', () => {
  const src = `function pick(x) {
    switch (x) {
      case 1: return 'a';
      case 2: return 'b';
      default: return 'd';
    }
  }
  log(pick(2));`
  const enabled = obfuscate(src)
  const disabled = obfuscate(src, { transforms: { switchToIf: false } })
  expect(enabled).not.toContain('switch (')
  expect(disabled).toContain('switch (')
})

test('obfuscate with arrowToFunction disabled keeps arrow expressions', () => {
  const src = `var f = (x) => x * 2; log(f(3));`
  const enabled = obfuscate(src)
  const disabled = obfuscate(src, { transforms: { arrowToFunction: false } })
  expect(enabled).not.toContain('=>')
  expect(disabled).toContain('=>')
})

test('obfuscate with optionalChainingToTernary disabled keeps the optional chain', () => {
  const src = `function getX(o) { return o?.a?.b; } log(getX({a: {b: 7}}));`
  const enabled = obfuscate(src)
  const disabled = obfuscate(src, { transforms: { optionalChainingToTernary: false } })
  expect(enabled).not.toContain('?.')
  expect(disabled).toContain('?.')
})

test('obfuscate with yodifyConditions disabled leaves comparison operand order intact', () => {
  const src = `var x = read(); if (x === 1) emit(); else other();`
  const enabled = obfuscate(src, { transforms: { numbersToStrings: false } })
  const disabled = obfuscate(src, {
    transforms: { yodifyConditions: false, numbersToStrings: false },
  })
  expect(enabled).toContain('1 ===')
  expect(disabled).toContain('=== 1')
})

test('obfuscate disabling extractObjectProperties leaves the wrapper variable in place', () => {
  const src = `var u = { f: function () { return 5; } };
log(u.f());
log(u.f());`
  const enabled = obfuscate(src)
  const disabled = obfuscate(src, {
    transforms: {
      extractObjectProperties: false,
      inlineFunctions: false,
      collapseSingleUseTemps: false,
      renameIdentifiers: false,
    },
  })
  expect(disabled).toMatch(/var\s+u\s*=\s*\{/)
  expect(enabled).not.toMatch(/var\s+u\s*=\s*\{/)
})

test('obfuscate with the entire fixed-point group disabled still produces a valid program', () => {
  const src = `function f(x) { return x + 1; } log(f(5));`
  const opts: ObfuscatorOptions = {
    transforms: {
      foldConstants: false,
      foldBuiltinMethods: false,
      extractObjectProperties: false,
      inlineFunctions: false,
      removeUnreachableCode: false,
      removeUnusedCode: false,
      removeAnonymousFunctionNames: false,
      collapseSingleUseTemps: false,
      renameIdentifiers: false,
      functionDeclarationToExpression: false,
    },
  }
  const out = obfuscate(src, opts)
  expect(out).toContain('function f')
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([6])
})

test('obfuscate behavioral parity: default vs every-transform-disabled-individually still preserves runtime', () => {
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
    const out = obfuscate(src, opts)
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

test('obfuscate enabling a transform explicitly via true matches the default', () => {
  const src = `var x = 1 + 2; log(x);`
  const def = obfuscate(src)
  const explicitTrue = obfuscate(src, { transforms: { foldConstants: true } })
  expect(def).toBe(explicitTrue)
})

// Disable inlining so the bindings under name-style tests survive.
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
  collapseSingleUseTemps: false,
  foldConstants: false,
  functionDeclarationToExpression: false,
} as const

test('obfuscate global stringGeneratorMode: hexadecimal renames bindings to _0x... names', () => {
  const out = obfuscate(RENAME_FIXTURE, {
    stringGeneratorMode: 'hexadecimal',
    transforms: NO_INLINE,
  })
  expect(out).toMatch(/function _0x[0-9a-f]+\(_0x[0-9a-f]+, _0x[0-9a-f]+\)/)
})

test('obfuscate global stringGeneratorMode: number renames bindings to var_N names', () => {
  const out = obfuscate(RENAME_FIXTURE, { stringGeneratorMode: 'number', transforms: NO_INLINE })
  expect(out).toMatch(/function var_\d+\(var_\d+, var_\d+\)/)
})

test('obfuscate global stringGeneratorMode: randomized produces valid-identifier names', () => {
  const out = obfuscate(RENAME_FIXTURE, {
    stringGeneratorMode: 'randomized',
    transforms: NO_INLINE,
  })
  expect(out).toMatch(/function [a-zA-Z_$][a-zA-Z_$0-9]*\(/)
})

test('obfuscate per-transform override: renameIdentifiers picks its own style over the global', () => {
  const out = obfuscate(RENAME_FIXTURE, {
    stringGeneratorMode: 'number',
    transforms: { ...NO_INLINE, renameIdentifiers: { stringGeneratorMode: 'hexadecimal' } },
  })
  expect(out).toMatch(/function _0x[0-9a-f]+\(/)
  expect(out).not.toMatch(/function var_\d+\(/)
})

test('obfuscate per-transform override: object form is enabled (not treated as falsy)', () => {
  const out = obfuscate(RENAME_FIXTURE, {
    transforms: { ...NO_INLINE, renameIdentifiers: { stringGeneratorMode: 'hexadecimal' } },
  })
  expect(out).toMatch(/function _0x[0-9a-f]+\(/)
})

test('obfuscate per-transform override: specialsToStrings can use number style for its string contents', () => {
  const src = `var x = undefined; log(x);`
  const out = obfuscate(src, {
    transforms: {
      ...NO_INLINE,
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
  const out = obfuscate(src, {
    stringGeneratorMode: ['hexadecimal', 'number'],
    transforms: NO_INLINE,
  })
  expect(out).toMatch(/_0x[0-9a-f]+/)
  expect(out).toMatch(/var_\d+/)
})

test('obfuscate per-transform `false` still disables, even when other transforms have object overrides', () => {
  const out = obfuscate(RENAME_FIXTURE, {
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

test('obfuscate leaves the unsafe property mangler disabled when omitted', () => {
  const omitted = obfuscate(PROPERTY_FIXTURE)
  const disabled = obfuscate(PROPERTY_FIXTURE, { transforms: { mangleProperties: false } })
  expect(omitted).toBe(disabled)
  expect(omitted).toContain('secret_')
})

test('obfuscate enables mangleProperties with true', () => {
  const out = obfuscate(PROPERTY_FIXTURE, { transforms: { mangleProperties: true } })
  expect(out).not.toContain('secret_')
})

test('obfuscate mangleProperties inherits the global stringGeneratorMode', () => {
  const out = obfuscate(PROPERTY_FIXTURE, {
    stringGeneratorMode: 'number',
    transforms: { mangleProperties: true },
  })
  expect(out).toContain('["var_1"]')
})

test('obfuscate mangleProperties can override the global stringGeneratorMode', () => {
  const out = obfuscate(PROPERTY_FIXTURE, {
    stringGeneratorMode: 'hexadecimal',
    transforms: { mangleProperties: { stringGeneratorMode: 'number' } },
  })
  expect(out).toContain('["var_1"]')
  expect(out).not.toMatch(/\["_0x[0-9a-f]+"\]/)
})

test('obfuscate mangleProperties custom nameGenerator takes precedence over string modes', () => {
  const out = obfuscate(PROPERTY_FIXTURE, {
    stringGeneratorMode: 'number',
    transforms: {
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
  const out = obfuscate(src, {
    transforms: {
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
  const out = obfuscate(src, {
    transforms: {
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
