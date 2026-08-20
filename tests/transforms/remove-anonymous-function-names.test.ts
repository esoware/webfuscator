import { expect, test } from 'vitest'

import { removeAnonymousFunctionNames } from 'src/transforms/remove-anonymous-function-names'

import { defineCases, run } from '../helpers'

const cases = defineCases('remove-anonymous-function-names', removeAnonymousFunctionNames, {
  unusedName: {
    name: 'removeAnonymousFunctionNames strips a redundant name that named evaluation re-derives',
    input: `var bar = function bar() {};`,
  },
  recursiveName: {
    name: 'removeAnonymousFunctionNames keeps a name that the body references for recursion',
    input: `var b = function rec(n) {
  return n <= 1 ? 1 : n * rec(n - 1);
};`,
  },

  arrowUntouched: {
    name: 'removeAnonymousFunctionNames does not affect arrow functions',
    input: `var fn = () => 1;`,
  },
  alreadyAnonymous: {
    name: 'removeAnonymousFunctionNames leaves an already-anonymous function expression alone',
    input: `var a = function () {};`,
  },
  functionDeclarationUntouched: {
    name: 'removeAnonymousFunctionNames does not strip a function declaration name',
    input: `function f() {
  return 1;
}`,
  },
  asArgument: {
    name: 'removeAnonymousFunctionNames keeps a name on a callback argument (no inference site)',
    input: `setTimeout(function fn() {
  log("tick");
}, 0);`,
  },
  selfReferenceInNestedScope: {
    name: 'removeAnonymousFunctionNames keeps a name referenced from a nested function',
    input: `var f = function rec() {
  return function () {
    return rec();
  };
};`,
  },
  differentInferredName: {
    name: 'removeAnonymousFunctionNames keeps a name when inference would supply a different one',
    input: `var f = function rec(rec) {
  return rec;
};`,
  },
})

test(cases.unusedName.name, () => {
  const out = run(cases.unusedName.input, removeAnonymousFunctionNames)
  expect(out).toContain('var bar = function (')
  expect(out).not.toContain('function bar(')
})

test(cases.recursiveName.name, () => {
  const out = run(cases.recursiveName.input, removeAnonymousFunctionNames)
  expect(out).toContain('function rec(n)')
  expect(out).toContain('rec(n - 1)')
})

test(cases.arrowUntouched.name, () => {
  expect(run(cases.arrowUntouched.input, removeAnonymousFunctionNames)).toContain(
    'var fn = () => 1',
  )
})

test(cases.alreadyAnonymous.name, () => {
  expect(run(cases.alreadyAnonymous.input, removeAnonymousFunctionNames)).toContain(
    'var a = function (',
  )
})

test(cases.functionDeclarationUntouched.name, () => {
  expect(run(cases.functionDeclarationUntouched.input, removeAnonymousFunctionNames)).toContain(
    'function f',
  )
})

test(cases.asArgument.name, () => {
  const out = run(cases.asArgument.input, removeAnonymousFunctionNames)
  expect(out).toContain('function fn(')
})

test(cases.selfReferenceInNestedScope.name, () => {
  const out = run(cases.selfReferenceInNestedScope.input, removeAnonymousFunctionNames)
  expect(out).toContain('function rec()')
})

test(cases.differentInferredName.name, () => {
  const out = run(cases.differentInferredName.input, removeAnonymousFunctionNames)
  expect(out).toContain('function rec(rec)')
})

test('removeAnonymousFunctionNames keeps a name written inside the body (A01-16)', () => {
  // The inner immutable binding absorbs the sloppy write before it reaches outer `g`.
  const code = `var g = function g() { g = 1; }; g(); log(typeof g);`
  const out = run(code, removeAnonymousFunctionNames)
  expect(out).toContain('function g(')
  const capture = (src: string): unknown[] => {
    const logs: unknown[] = []
    // oxlint-disable-next-line no-new-func
    new Function('log', src)((v: unknown) => logs.push(v))
    return logs
  }
  expect(capture(out)).toEqual(capture(code))
})

test('removeAnonymousFunctionNames keeps the strict TypeError on a self-name write (A01-16b)', () => {
  const code = `'use strict';
var g = function g() { g = 1; };
try { g(); log('no throw'); } catch (e) { log(e.constructor.name); }`
  const out = run(code, removeAnonymousFunctionNames)
  expect(out).toContain('function g(')
  const capture = (src: string): unknown[] => {
    const logs: unknown[] = []
    // oxlint-disable-next-line no-new-func
    new Function('log', src)((v: unknown) => logs.push(v))
    return logs
  }
  expect(capture(out)).toEqual(capture(code))
  expect(capture(out)).toEqual(['TypeError'])
})

test('removeAnonymousFunctionNames preserves an observable .name', () => {
  const evalLog = (program: string): unknown => {
    let captured: unknown
    // oxlint-disable-next-line no-new-func
    new Function('log', program)((v: unknown) => {
      captured = v
    })
    return captured
  }
  for (const expr of [
    '(function x() {}).name',
    '[function x() {}][0].name',
    '(function bar() {}).name',
    '({ p: function x() {} }).p.name',
  ]) {
    const program = `log(${expr});`
    expect(evalLog(run(program, removeAnonymousFunctionNames))).toBe(evalLog(program))
  }
})
