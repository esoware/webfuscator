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

// A clone carries the nested functions with it, so a call reached only through
// a closure still expands.
const REACHES_ITSELF: Record<string, string> = {
  ownBody: `function f() { return f(); }`,
  arrow: `function f() { return () => f(); }`,
  functionExpression: `function f() { return function () { return f(); }; }`,
  arrowInsideFunctionExpression: `function f() { return function () { return () => f(); }; }`,
  objectMethod: `function f() { return { m() { return f(); } }; }`,
  objectGetter: `function f() { return { get m() { return f(); } }; }`,
  classMethod: `function f() { return class { m() { return f(); } }; }`,
  nestedTwice: `function f() { return function () { return function () { return f(); }; }; }`,
  varFunctionExpression: `var f = function () { return function () { return f(); }; };`,
}

for (const [name, source] of Object.entries(REACHES_ITSELF)) {
  test(`analyzeInlineability refuses a candidate that reaches itself through ${name}`, () => {
    expect(isCandidate(`${source}\nlog(f());`)).toBe(false)
  })
}

// One edge hidden in a closure is enough to hide the whole cycle from Tarjan.
test('analyzeInlineability refuses mutual recursion whose back edge sits in a closure', () => {
  const candidates = analyzeInlineability(
    parse(
      `function f() { return g(); }
function g() { return function () { return f(); }; }
log(f());`,
      { sourceType: 'unambiguous' },
    ),
  )
  expect([...candidates.keys()]).toEqual([])
})

test('analyzeInlineability refuses a three-candidate cycle closed through nested methods', () => {
  const candidates = analyzeInlineability(
    parse(
      `function f() { return hook({ apply() { return h(); } }); }
function g() { return f(); }
function h() { return hook({ apply() { return g(); } }); }
log(h());`,
      { sourceType: 'unambiguous' },
    ),
  )
  expect([...candidates.keys()]).toEqual([])
})

// Edges come from bindings, so a member property spelling a candidate's name
// creates no edge.
test('analyzeInlineability accepts a candidate whose body reads a property of its own name', () => {
  expect(isCandidate(`function f() { return console.f(1); }\nlog(f());`)).toBe(true)
})

// The `g` inside `f` is the local var, so `f` gets no edge to `g` and no cycle
// forms.
test('analyzeInlineability accepts candidates whose only back edge is a shadowed name', () => {
  const candidates = analyzeInlineability(
    parse(`function f() { var g = 1; return g; }\nfunction g() { return f(); }\nlog(g());`, {
      sourceType: 'unambiguous',
    }),
  )
  expect([...candidates.keys()].toSorted()).toEqual(['f', 'g'])
})

// A cycle that closes outside the candidate set cannot expand, because the
// inliner never replaces the non-candidate call.
test('analyzeInlineability accepts a candidate whose cycle runs through a non-candidate', () => {
  expect(
    isCandidate(`function f() { return g(); }\nfunction g() { return f(this); }\nlog(f());`),
  ).toBe(true)
})
