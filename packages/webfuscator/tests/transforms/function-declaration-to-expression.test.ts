import { expect, test } from 'vitest'

import { functionDeclarationToExpression } from '../../src/transforms/function-declaration-to-expression'
import { defineCases, run } from '../helpers'

const cases = defineCases('function-declaration-to-expression', functionDeclarationToExpression, {
  simpleAfterDef: {
    name: 'functionDeclarationToExpression converts a function used after its definition',
    input: `const TAX = 0.2;
function withTax(n) {
  return n + n * TAX;
}
const total = withTax(100);`,
  },
  mutualRecursion: {
    name: 'functionDeclarationToExpression converts mutually recursive functions',
    input: `function isEven(n) {
  return n === 0 ? true : isOdd(n - 1);
}
function isOdd(n) {
  return n === 0 ? false : isEven(n - 1);
}
const r = isEven(10);`,
  },
  selfRecursion: {
    name: 'functionDeclarationToExpression converts a self-recursive function',
    input: `function fact(n) {
  return n <= 1 ? 1 : n * fact(n - 1);
}
const r = fact(5);`,
  },
  nestedInFunctionBody: {
    name: 'functionDeclarationToExpression converts a function nested in a function body',
    input: `function outer() {
  function inner() {
    return 3;
  }
  return inner();
}
const r = outer();`,
  },

  callBeforeDefNoOp: {
    name: 'functionDeclarationToExpression leaves a function called before its definition',
    input: `let log = 0;
call();
function call() {
  log = 1;
}`,
  },
  readBeforeDefNoOp: {
    name: 'functionDeclarationToExpression leaves a function read before its definition',
    input: `const g = f;
function f() {
  return 1;
}
const same = g === f;`,
  },
  sideEffectPrologueNoOp: {
    name: 'functionDeclarationToExpression leaves a function preceded by a side effect',
    input: `let seen = 0;
seen = seen + 1;
function f() {
  return 1;
}
const r = f();`,
  },
  blockScopedNoOp: {
    name: 'functionDeclarationToExpression leaves a block-scoped function declaration',
    input: `if (globalThis.always) {
  function bt() {
    return 1;
  }
}`,
  },
  moduleTopLevelNoOp: {
    name: 'functionDeclarationToExpression leaves a module top-level declaration',
    input: `export const y = 1;
function m() {
  return 1;
}`,
  },
  exportKeywordNoOp: {
    name: 'functionDeclarationToExpression leaves an exported function declaration',
    input: `export function f() {
  return 1;
}`,
  },
  exportSpecifierNoOp: {
    name: 'functionDeclarationToExpression leaves a function exported by a later specifier',
    input: `function f() {
  return 1;
}
export { f };`,
  },
  moduleNestedStillConverts: {
    name: 'functionDeclarationToExpression converts a nested function in a module but spares the top-level one',
    input: `import { dep } from "./dep.js";
function top() {
  function helper() {
    return dep;
  }
  return helper();
}`,
  },
  noModuleSyntaxConverts: {
    name: 'functionDeclarationToExpression treats a file with no import/export as a script and converts',
    input: `function api() {
  return compute();
}
function compute() {
  return 42;
}
const result = api();`,
  },
})

function evalWith(src: string, observe: string): unknown {
  // oxlint-disable-next-line no-new-func
  return new Function(`${src}\nreturn (${observe});`)()
}

function expectEquivalent(input: string, observe: string): string {
  const out = run(input, functionDeclarationToExpression)
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
  return out
}

test(cases.simpleAfterDef.name, () => {
  const out = expectEquivalent(cases.simpleAfterDef.input, '[total, withTax.name]')
  expect(out).toContain('var withTax = function')
  expect(evalWith(out, '[total, withTax.name]')).toEqual([120, 'withTax'])
})

test(cases.mutualRecursion.name, () => {
  const out = expectEquivalent(cases.mutualRecursion.input, 'r')
  expect(out).toContain('var isEven = function')
  expect(out).toContain('var isOdd = function')
  expect(evalWith(out, 'r')).toBe(true)
})

test(cases.selfRecursion.name, () => {
  const out = expectEquivalent(cases.selfRecursion.input, 'r')
  expect(out).toContain('var fact = function')
  expect(evalWith(out, 'r')).toBe(120)
})

test(cases.nestedInFunctionBody.name, () => {
  const out = expectEquivalent(cases.nestedInFunctionBody.input, 'r')
  expect(out).toContain('var outer = function')
  expect(out).toContain('var inner = function')
  expect(evalWith(out, 'r')).toBe(3)
})

test(cases.callBeforeDefNoOp.name, () => {
  const out = expectEquivalent(cases.callBeforeDefNoOp.input, 'log')
  expect(out).toContain('function call(')
  expect(out).not.toContain('var call =')
})

test(cases.readBeforeDefNoOp.name, () => {
  const out = expectEquivalent(cases.readBeforeDefNoOp.input, 'same')
  expect(out).toContain('function f(')
  expect(out).not.toContain('var f =')
})

test(cases.sideEffectPrologueNoOp.name, () => {
  const out = expectEquivalent(cases.sideEffectPrologueNoOp.input, 'r')
  expect(out).toContain('function f(')
})

test(cases.blockScopedNoOp.name, () => {
  const out = run(cases.blockScopedNoOp.input, functionDeclarationToExpression)
  expect(out).toContain('function bt(')
  expect(out).not.toContain('var bt =')
})

test(cases.moduleTopLevelNoOp.name, () => {
  const out = run(cases.moduleTopLevelNoOp.input, functionDeclarationToExpression)
  expect(out).toContain('function m(')
  expect(out).not.toContain('var m =')
})

test(cases.exportKeywordNoOp.name, () => {
  const out = run(cases.exportKeywordNoOp.input, functionDeclarationToExpression)
  expect(out).toContain('export function f(')
  expect(out).not.toContain('var f =')
})

// A separate export exposes the live, hoisted function binding to other modules.
test(cases.exportSpecifierNoOp.name, () => {
  const out = run(cases.exportSpecifierNoOp.input, functionDeclarationToExpression)
  expect(out).toContain('function f(')
  expect(out).not.toContain('var f =')
  expect(out).toContain('export { f }')
})

// A nested function cannot be exported across modules.
test(cases.moduleNestedStillConverts.name, () => {
  const out = run(cases.moduleNestedStillConverts.input, functionDeclarationToExpression)
  expect(out).toContain('function top(')
  expect(out).toContain('var helper = function')
})

test(cases.noModuleSyntaxConverts.name, () => {
  const out = expectEquivalent(cases.noModuleSyntaxConverts.input, 'result')
  expect(out).toContain('var api = function')
  expect(out).toContain('var compute = function')
  expect(evalWith(out, 'result')).toBe(42)
})
