import { expect, test } from 'vitest'

import { mulberry32 } from '../../src/utils/random'
import { StringGenerator } from '../../src/utils/string-generator'

test('mangled mode: same seed produces the same sequence', () => {
  const a = new StringGenerator('mangled', mulberry32(0))
  const b = new StringGenerator('mangled', mulberry32(0))
  for (let i = 0; i < 50; i++) {
    expect(a.next()).toBe(b.next())
  }
})

test('mangled mode: different seeds produce different sequences', () => {
  const a = new StringGenerator('mangled', mulberry32(0))
  const b = new StringGenerator('mangled', mulberry32(1))
  let differ = false
  for (let i = 0; i < 20; i++) {
    if (a.next() !== b.next()) {
      differ = true
      break
    }
  }
  expect(differ).toBe(true)
})

test('mangled mode: every name is unique within an instance', () => {
  const g = new StringGenerator('mangled', mulberry32(42))
  const seen = new Set<string>()
  for (let i = 0; i < 5000; i++) {
    const name = g.next()
    expect(seen.has(name)).toBe(false)
    seen.add(name)
  }
})

test('mangled mode: all names are valid JS identifiers', () => {
  const g = new StringGenerator('mangled', mulberry32(7))
  const idRe = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/
  for (let i = 0; i < 1000; i++) {
    const name = g.next()
    expect(name).toMatch(idRe)
  }
})

test('mangled mode: never emits a reserved keyword', () => {
  const reserved = new Set([
    'if',
    'in',
    'do',
    'for',
    'let',
    'new',
    'try',
    'var',
    'case',
    'else',
    'null',
    'with',
    'this',
    'true',
    'void',
    'break',
    'catch',
    'class',
    'const',
    'super',
    'throw',
    'while',
    'yield',
    'delete',
    'export',
    'import',
    'public',
    'return',
    'switch',
    'static',
    'typeof',
    'default',
    'finally',
    'private',
    'continue',
    'debugger',
    'function',
    'arguments',
    'eval',
  ])
  const g = new StringGenerator('mangled', mulberry32(0))
  for (let i = 0; i < 5000; i++) {
    expect(reserved.has(g.next())).toBe(false)
  }
})

test('zeroWidth mode: every name is unique within an instance', () => {
  const g = new StringGenerator('zeroWidth', mulberry32(0))
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const name = g.next()
    expect(seen.has(name)).toBe(false)
    seen.add(name)
  }
})

test('zeroWidth mode: every name parses as a valid JS identifier', () => {
  const g = new StringGenerator('zeroWidth', mulberry32(0))
  for (let i = 0; i < 100; i++) {
    const name = g.next()
    expect(() => new Function(`var ${name} = 1; return ${name};`)()).not.toThrow()
  }
})

test('zeroWidth mode: each name contains at least one ZWNJ', () => {
  const g = new StringGenerator('zeroWidth', mulberry32(0))
  for (let i = 0; i < 100; i++) {
    expect(g.next()).toContain('\u200C')
  }
})

test('zeroWidth mode: same seed produces same sequence', () => {
  const a = new StringGenerator('zeroWidth', mulberry32(99))
  const b = new StringGenerator('zeroWidth', mulberry32(99))
  for (let i = 0; i < 50; i++) {
    expect(a.next()).toBe(b.next())
  }
})

test('hexadecimal mode: every name matches `_0x[0-9a-f]+` and is a valid identifier', () => {
  const g = new StringGenerator('hexadecimal', mulberry32(0))
  for (let i = 0; i < 500; i++) {
    const name = g.next()
    expect(name).toMatch(/^_0x[0-9a-f]+$/)
    expect(() => new Function(`var ${name} = 1; return ${name};`)()).not.toThrow()
  }
})

test('hexadecimal mode: every name is unique within an instance', () => {
  const g = new StringGenerator('hexadecimal', mulberry32(0))
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const name = g.next()
    expect(seen.has(name)).toBe(false)
    seen.add(name)
  }
})

test('hexadecimal mode: same seed produces same sequence', () => {
  const a = new StringGenerator('hexadecimal', mulberry32(42))
  const b = new StringGenerator('hexadecimal', mulberry32(42))
  for (let i = 0; i < 50; i++) {
    expect(a.next()).toBe(b.next())
  }
})

test('randomized mode: every name is a valid identifier and starts with a non-digit', () => {
  const g = new StringGenerator('randomized', mulberry32(0))
  const idRe = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/
  for (let i = 0; i < 500; i++) {
    const name = g.next()
    expect(name).toMatch(idRe)
  }
})

test('randomized mode: every name is unique within an instance', () => {
  const g = new StringGenerator('randomized', mulberry32(0))
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const name = g.next()
    expect(seen.has(name)).toBe(false)
    seen.add(name)
  }
})

test('randomized mode: never emits a reserved keyword', () => {
  const reserved = new Set(['if', 'for', 'let', 'var', 'new', 'true', 'false', 'void'])
  const g = new StringGenerator('randomized', mulberry32(7))
  for (let i = 0; i < 1000; i++) {
    expect(reserved.has(g.next())).toBe(false)
  }
})

test('number mode: emits monotonic var_1, var_2, ... in order', () => {
  const g = new StringGenerator('number', mulberry32(0))
  for (let i = 1; i <= 10; i++) {
    expect(g.next()).toBe(`var_${i}`)
  }
})

test('number mode: every name is a valid identifier', () => {
  const g = new StringGenerator('number', mulberry32(0))
  for (let i = 0; i < 50; i++) {
    const name = g.next()
    expect(() => new Function(`var ${name} = 1; return ${name};`)()).not.toThrow()
  }
})

test('multi-mode: an array mixes both modes in the output', () => {
  const g = new StringGenerator(['mangled', 'hexadecimal'], mulberry32(0))
  let mangled = 0
  let hex = 0
  for (let i = 0; i < 200; i++) {
    const name = g.next()
    if (name.startsWith('_0x')) {
      hex++
    } else {
      mangled++
    }
  }
  expect(mangled).toBeGreaterThan(20)
  expect(hex).toBeGreaterThan(20)
})

test('multi-mode: every name is still unique across the mixed modes', () => {
  const g = new StringGenerator(['mangled', 'hexadecimal', 'randomized'], mulberry32(0))
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    const name = g.next()
    expect(seen.has(name)).toBe(false)
    seen.add(name)
  }
})

test('multi-mode: same seed produces same mixed sequence', () => {
  const a = new StringGenerator(['mangled', 'zeroWidth'], mulberry32(7))
  const b = new StringGenerator(['mangled', 'zeroWidth'], mulberry32(7))
  for (let i = 0; i < 100; i++) {
    expect(a.next()).toBe(b.next())
  }
})

test('multi-mode: an array of length 1 behaves identically to the bare style', () => {
  const a = new StringGenerator('mangled', mulberry32(0))
  const b = new StringGenerator(['mangled'], mulberry32(0))
  for (let i = 0; i < 50; i++) {
    expect(a.next()).toBe(b.next())
  }
})

test('empty modes array is rejected at construction', () => {
  expect(() => new StringGenerator([], mulberry32(0))).toThrow()
})
