import { parse } from '@babel/parser'
import { expect, test } from 'vitest'

import { analyzeInlineability } from '../../src/analysis/inlineability'

function isCandidate(code: string): boolean {
  return analyzeInlineability(parse(code, { sourceType: 'unambiguous' })).has('f')
}

// Destructured writes hide captured bindings below pattern nodes rather than the
// assignment itself.
const CAPTURING_WRITES: Record<string, string> = {
  plainAssignment: `p = 'w';`,
  updateExpression: `p++;`,
  arrayPattern: `[p] = ['w'];`,
  objectPattern: `({ q: p } = { q: 'w' });`,
  shorthandPattern: `({ p } = { p: 'w' });`,
  restPattern: `[...p] = ['w'];`,
  nestedPattern: `({ a: { b: p } } = { a: { b: 'w' } });`,
  defaultedPattern: `[p = 1] = [];`,
  forInPattern: `for ([p] in { x: 1 }) {}`,
  forOfPattern: `for ([p] of [['w']]) {}`,
}

for (const [name, write] of Object.entries(CAPTURING_WRITES)) {
  test(`analyzeInlineability refuses a candidate whose nested function writes a captured binding via ${name}`, () => {
    expect(
      isCandidate(`function f(p) { var g = function () { ${write} }; g(); return p; }\nlog(f(1));`),
    ).toBe(false)
  })
}

test('analyzeInlineability refuses a candidate whose nested function reads a captured binding', () => {
  expect(
    isCandidate(`function f(p) { var g = function () { return p; }; g(); return 1; }\nlog(f(1));`),
  ).toBe(false)
})

test('analyzeInlineability accepts a candidate whose nested function touches only its own bindings', () => {
  expect(
    isCandidate(
      `function f(p) { var g = function () { var z = 1; [z] = [2]; return z; }; g(); return p; }\nlog(f(1));`,
    ),
  ).toBe(true)
})

test('analyzeInlineability accepts a candidate with no nested function at all', () => {
  expect(isCandidate(`function f(p) { return p + 1; }\nlog(f(1));`)).toBe(true)
})

// Labels do not capture same-named variable bindings.
test('analyzeInlineability does not treat a label sharing a binding name as a capture', () => {
  expect(
    isCandidate(
      `function f(p) { var g = function () { p: for (;;) break p; }; g(); return 1; }\nlog(f(1));`,
    ),
  ).toBe(true)
})
