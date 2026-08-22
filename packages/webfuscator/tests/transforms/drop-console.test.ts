import { expect, test } from 'vitest'

import { dropConsole } from '../../src/transforms/drop-console'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('drop-console', dropConsole, {
  topLevelLog: {
    name: 'dropConsole removes a top-level console.log call',
    input: `console.log("hi");
log("after");`,
  },
  errorAndWarn: {
    name: 'dropConsole removes any console method call',
    input: `console.error("e");
console.warn("w");
console.info("i");
log("after");`,
  },
  bracketAccess: {
    name: 'dropConsole removes a console call written with bracket access',
    input: `console["log"]("hi");
log("after");`,
  },
  optionalChain: {
    name: 'dropConsole removes a console call written with optional chaining',
    input: `console?.log("hi");
log("after");`,
  },
  insideFunction: {
    name: 'dropConsole removes a console call from a function body',
    input: `function foo() {
  console.log("hi");
  return "bar";
}`,
  },
  shadowedByParameter: {
    name: 'dropConsole keeps console calls when console is a function parameter',
    input: `function bar(console) {
  console.log("kept");
}`,
  },
  shadowedByLocalVar: {
    name: 'dropConsole keeps console calls when console is a local variable',
    input: `function f() {
  var console = customLogger;
  console.log("kept");
}`,
  },
  shadowedByImport: {
    name: 'dropConsole keeps console calls when console is imported',
    input: `import { console } from "./logger";
console.log("kept");`,
  },
  combinedFromSpec: {
    name: 'dropConsole drops global console and keeps shadowed console in the same module',
    input: `function foo() {
  console.log("hi");
  return "bar";
}
function bar(console) {
  console.log("kept");
}`,
  },
  leavesIndirectCall: {
    name: 'dropConsole leaves indirect console calls alone',
    input: `console.log.call(this, "hi");
log("after");`,
  },
  leavesAssignedReturnValue: {
    name: 'dropConsole leaves console calls whose return value is used',
    input: `var x = console.log("hi");
log("after");`,
  },
  leavesAwaitedCall: {
    name: 'dropConsole leaves an awaited console call',
    input: `async function f() {
  await console.log("hi");
}`,
  },
})

test(cases.topLevelLog.name, () => {
  const out = run(cases.topLevelLog.input, dropConsole)
  expect(out).not.toContain('console')
  expect(out).toContain('log("after")')
})

test(cases.errorAndWarn.name, () => {
  const out = run(cases.errorAndWarn.input, dropConsole)
  expect(out).not.toContain('console')
  expect(out).toContain('log("after")')
})

test(cases.bracketAccess.name, () => {
  const out = run(cases.bracketAccess.input, dropConsole)
  expect(out).not.toContain('console')
  expect(out).toContain('log("after")')
})

test(cases.optionalChain.name, () => {
  const out = run(cases.optionalChain.input, dropConsole)
  expect(out).not.toContain('console')
  expect(out).toContain('log("after")')
})

test(cases.insideFunction.name, () => {
  const out = run(cases.insideFunction.input, dropConsole)
  expect(out).not.toContain('console')
  expect(out).toContain('return "bar"')
})

test(cases.shadowedByParameter.name, () => {
  const out = run(cases.shadowedByParameter.input, dropConsole)
  expect(out).toContain('console.log("kept")')
})

test(cases.shadowedByLocalVar.name, () => {
  const out = run(cases.shadowedByLocalVar.input, dropConsole)
  expect(out).toContain('console.log("kept")')
})

test(cases.shadowedByImport.name, () => {
  const out = run(cases.shadowedByImport.input, dropConsole)
  expect(out).toContain('console.log("kept")')
})

test(cases.combinedFromSpec.name, () => {
  const out = run(cases.combinedFromSpec.input, dropConsole)
  expect(out).not.toContain('console.log("hi")')
  expect(out).toContain('console.log("kept")')
  expect(out).toContain('return "bar"')
})

test(cases.leavesIndirectCall.name, () => {
  const out = run(cases.leavesIndirectCall.input, dropConsole)
  expect(out).toContain('console.log.call(this, "hi")')
})

test(cases.leavesAssignedReturnValue.name, () => {
  const out = run(cases.leavesAssignedReturnValue.input, dropConsole)
  expect(out).toContain('var x = console.log("hi")')
})

test(cases.leavesAwaitedCall.name, () => {
  const out = run(cases.leavesAwaitedCall.input, dropConsole)
  expect(out).toContain('await console.log("hi")')
})

function preservesConsole(code: string): void {
  expect(trace(run(code, dropConsole))).toEqual(trace(code))
}

test('dropConsole keeps argument side effects (F9)', () => {
  preservesConsole("function s() { log('side'); return 1 } console.log(s());")
})

test('dropConsole does not drop a with-shadowed console (F10)', () => {
  preservesConsole(
    "var o = { console: { log: function (v) { log('kept', v) } } }; with (o) { console.log(1) }",
  )
})

test('dropConsole keeps a call when the global console is reassigned (A10-15)', () => {
  const code = "console = { log: function (v) { log('custom', v); } };\nconsole.log(1);"
  const out = run(code, dropConsole)
  expect(out).toContain('console.log(1)')
  // Inject `console` so reassignment cannot alter the test runner's global.
  const capture = (src: string): unknown[] => {
    const calls: unknown[] = []
    // oxlint-disable-next-line no-new-func
    new Function('log', 'console', src)((...a: unknown[]) => calls.push(a.length === 1 ? a[0] : a))
    return calls
  }
  expect(capture(out)).toEqual(capture(code))
  expect(capture(out)).toEqual([['custom', 1]])
})
