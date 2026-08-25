import generate from '@babel/generator'
import { parse } from '@babel/parser'
import { expect, test } from 'vitest'

import { mergeVariableDeclarations } from '../../src/transforms/merge-variable-declarations'
import { defineCases, run, trace } from '../helpers'

function expectEquivalent(input: string): string {
  const out = run(input, mergeVariableDeclarations)
  expect(trace(out)).toEqual(trace(input))
  return out
}

defineCases('merge-variable-declarations', mergeVariableDeclarations, {
  adjacentLets: {
    name: 'mergeVariableDeclarations fuses consecutive let declarations',
    input: `let a = 1;\nlet b = 2;\nlog(a + b);`,
  },
  adjacentConsts: {
    name: 'mergeVariableDeclarations fuses consecutive const declarations',
    input: `const a = 1;\nconst b = a + 1;\nlog(a + b);`,
  },
})

test('fuses consecutive same-kind declarations into one', () => {
  const out = expectEquivalent(`let a = 1;\nlet b = 2;\nlog(a + b);`)
  expect(out).toContain('let a = 1,')
  expect(out).not.toMatch(/let b/)
})

test('preserves left-to-right evaluation when a later declarator reads an earlier one', () => {
  expect(trace(run(`let a = 1;\nlet b = a + 1;\nlog(b);`, mergeVariableDeclarations))).toEqual({
    logs: [2],
    threw: null,
  })
})

test('does not merge across a different kind', () => {
  const out = expectEquivalent(`let a = 1;\nconst b = 2;\nlog(a + b);`)
  expect(out).toContain('let a = 1;')
  expect(out).toContain('const b = 2;')
})

test('does not merge across an intervening statement', () => {
  const src = `let a = 1;\nlog(a);\nlet b = 2;\nlog(b);`
  const out = expectEquivalent(src)
  expect(out).toContain('let a = 1;')
  expect(out).toContain('let b = 2;')
})

test('preserves initializer side-effect order', () => {
  const src = `let order = [];\nlet a = (order.push(1), 1);\nlet b = (order.push(2), 2);\nlog(order.join(","));`
  expect(trace(run(src, mergeVariableDeclarations))).toEqual({ logs: ['1,2'], threw: null })
})

test('merges var declarations', () => {
  const out = expectEquivalent(`var a = 1;
var b = 2;
log(a + b);`)
  expect(out).toContain('var a = 1,')
})

test('merges declarations inside blocks and switch cases', () => {
  const src = `{
  let a = 1;
  let b = 2;
  log(a + b);
}
switch (1) {
  case 1:
    let c = 3;
    let d = 4;
    log(c + d);
}`
  const out = expectEquivalent(src)
  expect(out).toContain('let a = 1,')
  expect(out).toContain('let c = 3,')
})

test('merges declarations inside static initialization blocks', () => {
  const src = `class C {
  static {
    let a = 1;
    let b = 2;
    log(a + b);
  }
}`
  const out = expectEquivalent(src)
  expect(out).toContain('let a = 1,')
})

test('merges adjacent direct exports', () => {
  const out = run(
    `export let a = 1;
export let b = 2;`,
    mergeVariableDeclarations,
  )
  expect(out).toContain('export let a = 1,')
  expect(() => parse(out, { sourceType: 'module' })).not.toThrow()
})

test('merges across unlabeled empty statements', () => {
  const out = expectEquivalent(`let a = 1;
;
let b = 2;
log(a + b);`)
  expect(out).toContain('let a = 1,')
  expect(out).not.toContain('\n;')
})

test('merges declarations containing functions and classes', () => {
  const src = `let make = function () { return 1; };
let Box = class { value() { return 2; } };
log(make() + new Box().value());`
  const out = expectEquivalent(src)
  expect(out).toContain('let make = function ()')
  expect(out).not.toMatch(/\nlet Box/u)
})

test('preserves abrupt initializer completion', () => {
  const abrupt = `try {
  let a = (() => { throw 1; })();
  let b = 2;
} catch (error) {
  log(error);
}`
  expectEquivalent(abrupt)
})

test('merges using declarations without changing disposal order', () => {
  const src = `const resourceA = { [Symbol.dispose]() { log("a"); } };
const resourceB = { [Symbol.dispose]() { log("b"); } };
{
  using a = resourceA;
  using b = resourceB;
  log("body");
}`
  const out = expectEquivalent(src)
  expect(out).toContain('using a =')
  expect(out).not.toMatch(/\n\s*using b/)
  expect(trace(out)).toEqual({ logs: ['body', 'b', 'a'], threw: null })
})

test('merges await using declarations without changing asynchronous disposal order', async () => {
  const src = `const resourceA = { async [Symbol.asyncDispose]() { log("a"); } };
const resourceB = { async [Symbol.asyncDispose]() { log("b"); } };
async function f() {
  await using a = resourceA;
  await using b = resourceB;
  log("body");
}`
  const out = run(src, mergeVariableDeclarations)
  expect(out).not.toMatch(/\n\s*await using b/)

  const evaluate = async (code: string): Promise<string[]> => {
    const logs: string[] = []
    // oxlint-disable-next-line no-new-func
    const promise = new Function('log', `${code}\nreturn f();`)((value: string) => logs.push(value))
    await promise
    return logs
  }
  expect(await evaluate(out)).toEqual(await evaluate(src))
  expect(await evaluate(out)).toEqual(['body', 'b', 'a'])
})

test('reports no change after declarations merge', () => {
  const ast = parse(`let a = 1;
let b = 2;`)
  expect(mergeVariableDeclarations(ast)).toBe(true)
  const once = generate(ast).code
  expect(mergeVariableDeclarations(ast)).toBe(false)
  expect(generate(ast).code).toBe(once)
})
