import { expect, test } from 'vitest'

import { splitSequenceExpressions } from 'src/preparation/split-sequence-expressions'

import { defineCases, run, trace } from '../helpers'

const cases = defineCases('split-sequence-expressions', splitSequenceExpressions, {
  threeCalls: {
    name: 'splitSequenceExpressions splits a top-level three-expression sequence into separate statements',
    input: `a(), b(), c();`,
  },
  twoCalls: {
    name: 'splitSequenceExpressions splits a two-expression sequence into separate statements',
    input: `a(), b();`,
  },
  preservesOrder: {
    name: 'splitSequenceExpressions preserves the original expression order',
    input: `a(), b(), c();`,
  },
  leavesNonSequenceStatementsUntouched: {
    name: 'splitSequenceExpressions leaves expression statements without a sequence unchanged',
    input: `a();
b();`,
  },
  splitsInsideFunctionBody: {
    name: 'splitSequenceExpressions splits sequences that appear inside function bodies',
    input: `function f() {
  a(), b();
}`,
  },
  skipsForLoopInit: {
    name: 'splitSequenceExpressions does not split sequence expressions in for-loop init',
    input: `for (i = 0, j = 0; i < 10; i++) {
  log(i);
}`,
  },
  skipsUnwrappedIfBody: {
    name: 'splitSequenceExpressions skips sequences that are the sole body of a control-flow statement',
    input: `if (x) a(), b();`,
  },
})

test(cases.threeCalls.name, () => {
  const out = run(cases.threeCalls.input, splitSequenceExpressions)
  expect(out).not.toContain('a(), b()')
  expect(out).toContain('a();')
  expect(out).toContain('b();')
  expect(out).toContain('c();')
})

test(cases.twoCalls.name, () => {
  const out = run(cases.twoCalls.input, splitSequenceExpressions)
  expect(out).not.toContain('a(), b()')
  expect(out).toContain('a();')
  expect(out).toContain('b();')
})

test(cases.preservesOrder.name, () => {
  const out = run(cases.preservesOrder.input, splitSequenceExpressions)
  expect(out.indexOf('a();')).toBeLessThan(out.indexOf('b();'))
  expect(out.indexOf('b();')).toBeLessThan(out.indexOf('c();'))
})

test(cases.leavesNonSequenceStatementsUntouched.name, () => {
  const out = run(cases.leavesNonSequenceStatementsUntouched.input, splitSequenceExpressions)
  expect(out).toContain('a();')
  expect(out).toContain('b();')
  expect(out).not.toContain('a(), b()')
})

test(cases.splitsInsideFunctionBody.name, () => {
  const out = run(cases.splitsInsideFunctionBody.input, splitSequenceExpressions)
  expect(out).not.toContain('a(), b()')
  expect(out).toContain('a();')
  expect(out).toContain('b();')
})

test(cases.skipsForLoopInit.name, () => {
  const out = run(cases.skipsForLoopInit.input, splitSequenceExpressions)
  expect(out).toContain('i = 0, j = 0')
})

test(cases.skipsUnwrappedIfBody.name, () => {
  const out = run(cases.skipsUnwrappedIfBody.input, splitSequenceExpressions)
  expect(out).toContain('a(), b()')
})

test('splitSequenceExpressions does not promote a leading string into a directive', () => {
  const nonSimple = 'function f(a = 1){ "use strict", 0; return a }'
  expect(() => new Function(run(`${nonSimple} f();`, splitSequenceExpressions))).not.toThrow()
  const sloppy = '"use strict", 0; log(typeof function(){ return this; }());'
  expect(trace(run(sloppy, splitSequenceExpressions))).toEqual(trace(sloppy))
})
