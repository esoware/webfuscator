import { expect, test } from 'vitest'

import { doWhileToWhile } from '../../src/transforms/do-while-to-while'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('do-while-to-while', doWhileToWhile, {
  simpleNoContinue: {
    name: 'doWhileToWhile rewrites a plain do-while and drops the unused label',
    input: `let i = 0;
do {
  i++;
} while (i < 3);`,
  },
  runsBodyOnce: {
    name: 'doWhileToWhile keeps the body running before the first test',
    input: `let i = 10;
let ran = 0;
do {
  i++;
  ran++;
} while (i < 3);`,
  },
  continueRedirect: {
    name: 'doWhileToWhile redirects an unlabeled continue to break the iteration block',
    input: `let i = 0;
let hits = 0;
do {
  i++;
  if (i === 2) continue;
  hits++;
} while (i < 4);`,
  },
  labeledContinue: {
    name: 'doWhileToWhile redirects continue <ourLabel>',
    input: `let i = 0;
let hits = 0;
outer: do {
  i++;
  if (i === 2) continue outer;
  hits++;
} while (i < 4);`,
  },
  unlabeledBreak: {
    name: 'doWhileToWhile leaves an unlabeled break exiting the loop',
    input: `let i = 0;
do {
  i++;
  if (i === 2) break;
} while (i < 10);`,
  },
  nestedContinueUntouched: {
    name: 'doWhileToWhile leaves a continue bound to a nested loop alone',
    input: `let outerCount = 0;
let inner = 0;
do {
  outerCount++;
  for (let j = 0; j < 3; j++) {
    if (j === 1) continue;
    inner++;
  }
} while (outerCount < 2);`,
  },
  conciseBody: {
    name: 'doWhileToWhile handles a single-statement body',
    input: `let i = 0;
do i++;
while (i < 3);`,
  },
})

function evalWith(src: string, observe: string): unknown {
  // oxlint-disable-next-line no-new-func
  return new Function(`${src}\nreturn (${observe});`)()
}

function expectEquivalent(input: string, observe: string): string {
  const out = run(input, doWhileToWhile)
  expect(evalWith(out, observe)).toEqual(evalWith(input, observe))
  expect(out).not.toContain('} while')
  return out
}

test(cases.simpleNoContinue.name, () => {
  const out = expectEquivalent(cases.simpleNoContinue.input, 'i')
  expect(out).toMatch(/while \(true\)/)
  expect(out).not.toContain('_doIteration')
  expect(evalWith(out, 'i')).toBe(3)
})

test(cases.runsBodyOnce.name, () => {
  const out = expectEquivalent(cases.runsBodyOnce.input, '[i, ran]')
  expect(evalWith(out, '[i, ran]')).toEqual([11, 1])
})

test(cases.continueRedirect.name, () => {
  const out = expectEquivalent(cases.continueRedirect.input, '[i, hits]')
  expect(out).toMatch(/break _doIteration/)
  expect(out).not.toMatch(/\bcontinue;/)
  expect(evalWith(out, '[i, hits]')).toEqual([4, 3])
})

test(cases.labeledContinue.name, () => {
  const out = expectEquivalent(cases.labeledContinue.input, '[i, hits]')
  expect(out).toMatch(/break _doIteration/)
  expect(out).not.toContain('continue outer')
  expect(evalWith(out, '[i, hits]')).toEqual([4, 3])
})

test(cases.unlabeledBreak.name, () => {
  const out = expectEquivalent(cases.unlabeledBreak.input, 'i')
  expect(evalWith(out, 'i')).toBe(2)
})

test(cases.nestedContinueUntouched.name, () => {
  const out = expectEquivalent(cases.nestedContinueUntouched.input, '[outerCount, inner]')
  expect(out).toMatch(/\bcontinue;/)
  expect(evalWith(out, '[outerCount, inner]')).toEqual([2, 4])
})

test(cases.conciseBody.name, () => {
  const out = expectEquivalent(cases.conciseBody.input, 'i')
  expect(evalWith(out, 'i')).toBe(3)
})

test('doWhileToWhile does not leak a body binding into the exit test', () => {
  const src =
    'var n = 0; var c = false; do { let c = true; n = n + 1; if (n > 20) break; } while (c); log(n);'
  expect(trace(run(src, doWhileToWhile))).toEqual(trace(src))
})

test('doWhileToWhile does not collide the inner label with an enclosing user label', () => {
  const src = '_doIteration: do { log("x"); continue; } while (false);'
  expect(() => new Function('log', run(src, doWhileToWhile))).not.toThrow()
})
