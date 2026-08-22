import { expect, test } from 'vitest'

import { wrapSingleStatements } from '../../src/preparation/wrap-single-statements'
import { defineCases, run } from '../helpers'

const cases = defineCases('wrap-single-statements', wrapSingleStatements, {
  ifConsequent: {
    name: 'wrapSingleStatements wraps an unwrapped if consequent in a block',
    input: `if (x) log(1);`,
  },
  ifElseBoth: {
    name: 'wrapSingleStatements wraps both branches of an if/else',
    input: `if (x) log(1);
else log(2);`,
  },
  whileBody: {
    name: 'wrapSingleStatements wraps an unwrapped while body',
    input: `while (y) step();`,
  },
  doWhileBody: {
    name: 'wrapSingleStatements wraps an unwrapped do-while body',
    input: `do step(); while (y);`,
  },
  forBody: {
    name: 'wrapSingleStatements wraps an unwrapped for body',
    input: `for (var i = 0; i < n; i++) work(i);`,
  },
  forInBody: {
    name: 'wrapSingleStatements wraps an unwrapped for-in body',
    input: `for (var k in obj) use(k);`,
  },
  forOfBody: {
    name: 'wrapSingleStatements wraps an unwrapped for-of body',
    input: `for (var v of arr) use(v);`,
  },
  arrowConciseBody: {
    name: 'wrapSingleStatements turns a concise arrow body into a block with an explicit return',
    input: `var fn = x => x + 1;`,
  },
  arrowBlockBodyUnchanged: {
    name: 'wrapSingleStatements leaves arrow functions that already have block bodies alone',
    input: `var fn = x => {
  return x + 1;
};`,
  },
  alreadyBlockedConsequentUnchanged: {
    name: 'wrapSingleStatements does not double-wrap an if body that is already a block',
    input: `if (x) {
  log(1);
}`,
  },
  preservesElseIfChain: {
    name: 'wrapSingleStatements preserves else-if chains rather than wrapping the inner if',
    input: `if (x) log(1);
else if (y) log(2);
else log(3);`,
  },
  nestedIfWhile: {
    name: 'wrapSingleStatements wraps both an outer if and its inner while when both are unwrapped',
    input: `if (x) while (y) step();`,
  },
})

test(cases.ifConsequent.name, () => {
  const out = run(cases.ifConsequent.input, wrapSingleStatements)
  expect(out).toMatch(/if \(x\) \{[\s\S]*log\(1\);[\s\S]*\}/)
})

test(cases.ifElseBoth.name, () => {
  const out = run(cases.ifElseBoth.input, wrapSingleStatements)
  expect(out).toMatch(/if \(x\) \{[\s\S]*log\(1\);[\s\S]*\} else \{[\s\S]*log\(2\);[\s\S]*\}/)
})

test(cases.whileBody.name, () => {
  const out = run(cases.whileBody.input, wrapSingleStatements)
  expect(out).toMatch(/while \(y\) \{[\s\S]*step\(\);[\s\S]*\}/)
})

test(cases.doWhileBody.name, () => {
  const out = run(cases.doWhileBody.input, wrapSingleStatements)
  expect(out).toMatch(/do \{[\s\S]*step\(\);[\s\S]*\} while/)
})

test(cases.forBody.name, () => {
  const out = run(cases.forBody.input, wrapSingleStatements)
  expect(out).toMatch(/for \(var i = 0; i < n; i\+\+\) \{[\s\S]*work\(i\);[\s\S]*\}/)
})

test(cases.forInBody.name, () => {
  const out = run(cases.forInBody.input, wrapSingleStatements)
  expect(out).toMatch(/for \(var k in obj\) \{[\s\S]*use\(k\);[\s\S]*\}/)
})

test(cases.forOfBody.name, () => {
  const out = run(cases.forOfBody.input, wrapSingleStatements)
  expect(out).toMatch(/for \(var v of arr\) \{[\s\S]*use\(v\);[\s\S]*\}/)
})

test(cases.arrowConciseBody.name, () => {
  const out = run(cases.arrowConciseBody.input, wrapSingleStatements)
  expect(out).toMatch(/=> \{[\s\S]*return x \+ 1;[\s\S]*\}/)
})

test(cases.arrowBlockBodyUnchanged.name, () => {
  const out = run(cases.arrowBlockBodyUnchanged.input, wrapSingleStatements)
  expect(out.match(/return x \+ 1/g)?.length).toBe(1)
  expect(out).not.toMatch(/return \{[\s\S]*return/)
})

test(cases.alreadyBlockedConsequentUnchanged.name, () => {
  const out = run(cases.alreadyBlockedConsequentUnchanged.input, wrapSingleStatements)
  expect(out.match(/\{[\s\S]*log\(1\);[\s\S]*\}/g)?.length).toBe(1)
})

test(cases.preservesElseIfChain.name, () => {
  const out = run(cases.preservesElseIfChain.input, wrapSingleStatements)
  expect(out).toContain('else if (y)')
  expect(out).not.toMatch(/else \{\s*if \(y\)/)
})

test(cases.nestedIfWhile.name, () => {
  const out = run(cases.nestedIfWhile.input, wrapSingleStatements)
  expect(out).toMatch(/if \(x\) \{[\s\S]*while \(y\) \{[\s\S]*step\(\);[\s\S]*\}[\s\S]*\}/)
})
