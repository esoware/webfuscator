import { expect, test } from 'vitest'

import { dropDebugger } from '../../src/transforms/drop-debugger'
import { defineCases, run } from '../helpers'

const cases = defineCases('drop-debugger', dropDebugger, {
  inFunctionBody: {
    name: 'dropDebugger removes a debugger statement from a function body',
    input: `function foo() {
  debugger;
  return "bar";
}`,
  },
  topLevel: {
    name: 'dropDebugger removes a top-level debugger statement',
    input: `debugger;
log("after");`,
  },
  insideIfBody: {
    name: 'dropDebugger removes a debugger inside an if block',
    input: `if (x) {
  debugger;
  log("hit");
}`,
  },
  multipleDebuggers: {
    name: 'dropDebugger removes every debugger statement',
    input: `function foo() {
  debugger;
  log(1);
  debugger;
  log(2);
}`,
  },
  unchangedWhenNoneExist: {
    name: 'dropDebugger leaves code without debugger statements unchanged',
    input: `function foo() {
  return "bar";
}`,
  },
})

test(cases.inFunctionBody.name, () => {
  const out = run(cases.inFunctionBody.input, dropDebugger)
  expect(out).not.toContain('debugger')
  expect(out).toContain('return "bar"')
})

test(cases.topLevel.name, () => {
  const out = run(cases.topLevel.input, dropDebugger)
  expect(out).not.toContain('debugger')
  expect(out).toContain('log("after")')
})

test(cases.insideIfBody.name, () => {
  const out = run(cases.insideIfBody.input, dropDebugger)
  expect(out).not.toContain('debugger')
  expect(out).toContain('log("hit")')
})

test(cases.multipleDebuggers.name, () => {
  const out = run(cases.multipleDebuggers.input, dropDebugger)
  expect(out).not.toContain('debugger')
  expect(out).toContain('log(1)')
  expect(out).toContain('log(2)')
})

test(cases.unchangedWhenNoneExist.name, () => {
  const out = run(cases.unchangedWhenNoneExist.input, dropDebugger)
  expect(out).toContain('return "bar"')
  expect(out).not.toContain('debugger')
})

function preservesDebugger(code: string): void {
  const capture = (src: string): unknown[] => {
    const calls: unknown[] = []
    // oxlint-disable-next-line no-new-func
    new Function('log', src)((...a: unknown[]) => calls.push(a.length === 1 ? a[0] : a))
    return calls
  }
  const out = run(code, dropDebugger)
  expect(out).not.toContain('debugger')
  expect(() => capture(out)).not.toThrow()
  expect(capture(out)).toEqual(capture(code))
}

test('dropDebugger replaces a bare debugger with-body without a null child (A10-16)', () => {
  preservesDebugger('var o = { a: 1 }; with (o) debugger; log("after");')
})

test('dropDebugger handles a with-body debugger nested in an if (A10-16)', () => {
  preservesDebugger('var o = {}; if (1) with (o) debugger; log("after");')
})

test('dropDebugger replaces a labeled debugger with an empty statement (A10-16)', () => {
  preservesDebugger('foo: debugger;\nlog("after");')
})
