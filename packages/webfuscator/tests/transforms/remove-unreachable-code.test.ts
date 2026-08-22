import type { File } from '@babel/types'
import { expect, test } from 'vitest'

import { removeUnreachableCode } from '../../src/transforms/remove-unreachable-code'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('remove-unreachable-code', removeUnreachableCode, {
  specReturn: {
    name: 'removeUnreachableCode drops statements after a return inside a function body',
    input: `function foo() {
  return "bar";
  log("baz");
}`,
  },

  afterThrow: {
    name: 'removeUnreachableCode drops statements after a throw',
    input: `function foo() {
  throw new Error("x");
  log("dead");
}`,
  },
  afterBreakInLoop: {
    name: 'removeUnreachableCode drops statements after a break inside a loop body',
    input: `for (var i = 0; i < 3; i++) {
  break;
  log("dead");
}`,
  },
  afterContinueInLoop: {
    name: 'removeUnreachableCode drops statements after a continue inside a loop body',
    input: `for (var i = 0; i < 3; i++) {
  continue;
  log("dead");
}`,
  },

  inSwitchCase: {
    name: 'removeUnreachableCode drops statements after a break in a switch case',
    input: `switch (x) {
  case 1:
    foo();
    break;
    log("dead");
}`,
  },
  inLabeledBlock: {
    name: 'removeUnreachableCode drops statements after a labeled break inside the label',
    input: `outer: {
  break outer;
  log("dead");
}
log("alive");`,
  },
  insideArrowBlockBody: {
    name: 'removeUnreachableCode drops statements after a return in an arrow with block body',
    input: `var fn = () => {
  return 1;
  log("dead");
};`,
  },

  preservesFunctionDeclaration: {
    name: 'removeUnreachableCode keeps a function declaration after a return (hoisted)',
    input: `function f() {
  return helper();
  function helper() {
    return "ok";
  }
}`,
  },
  preservesVarDeclaration: {
    name: 'removeUnreachableCode keeps a var declaration after a return (hoisted)',
    input: `function f() {
  return typeof x;
  var x = 1;
}`,
  },
  dropsLetAfterReturn: {
    name: 'removeUnreachableCode drops a let declaration after a return (block-scoped, unobservable)',
    input: `function f() {
  return 1;
  let x = 2;
}`,
  },

  leavesAloneWithoutCompletion: {
    name: 'removeUnreachableCode does nothing when there is no completion in the body',
    input: `function f() {
  log(1);
  log(2);
}`,
  },
  onlyAffectsItsOwnBlock: {
    name: 'removeUnreachableCode only prunes the block that contains the completion',
    input: `function f() {
  if (cond) {
    return 1;
    log("inner-dead");
  }
  log("outer-alive");
}`,
  },

  ignoresLaterCompletion: {
    name: 'removeUnreachableCode prunes from the first completion only',
    input: `function f() {
  return 1;
  return 2;
  log("dead");
}`,
  },
})

test(cases.specReturn.name, () => {
  const out = run(cases.specReturn.input, removeUnreachableCode)
  expect(out).toContain('return "bar"')
  expect(out).not.toContain('log("baz")')
})

test(cases.afterThrow.name, () => {
  expect(run(cases.afterThrow.input, removeUnreachableCode)).not.toContain('log("dead")')
})

test(cases.afterBreakInLoop.name, () => {
  expect(run(cases.afterBreakInLoop.input, removeUnreachableCode)).not.toContain('log("dead")')
})

test(cases.afterContinueInLoop.name, () => {
  expect(run(cases.afterContinueInLoop.input, removeUnreachableCode)).not.toContain('log("dead")')
})

test(cases.inSwitchCase.name, () => {
  const out = run(cases.inSwitchCase.input, removeUnreachableCode)
  expect(out).toContain('break')
  expect(out).not.toContain('log("dead")')
})

test(cases.inLabeledBlock.name, () => {
  const out = run(cases.inLabeledBlock.input, removeUnreachableCode)
  expect(out).not.toContain('log("dead")')
  expect(out).toContain('log("alive")')
})

test(cases.insideArrowBlockBody.name, () => {
  expect(run(cases.insideArrowBlockBody.input, removeUnreachableCode)).not.toContain('log("dead")')
})

test(cases.preservesFunctionDeclaration.name, () => {
  const out = run(cases.preservesFunctionDeclaration.input, removeUnreachableCode)
  expect(out).toContain('return helper()')
  expect(out).toContain('function helper')
})

test(cases.preservesVarDeclaration.name, () => {
  const out = run(cases.preservesVarDeclaration.input, removeUnreachableCode)
  expect(out).toContain('var x = 1')
})

test(cases.dropsLetAfterReturn.name, () => {
  const out = run(cases.dropsLetAfterReturn.input, removeUnreachableCode)
  expect(out).not.toContain('let x')
})

test(cases.leavesAloneWithoutCompletion.name, () => {
  const out = run(cases.leavesAloneWithoutCompletion.input, removeUnreachableCode)
  expect(out).toContain('log(1)')
  expect(out).toContain('log(2)')
})

test(cases.onlyAffectsItsOwnBlock.name, () => {
  const out = run(cases.onlyAffectsItsOwnBlock.input, removeUnreachableCode)
  expect(out).not.toContain('log("inner-dead")')
  expect(out).toContain('log("outer-alive")')
})

test(cases.ignoresLaterCompletion.name, () => {
  const out = run(cases.ignoresLaterCompletion.input, removeUnreachableCode)
  expect(out).toContain('return 1')
  expect(out).not.toContain('return 2')
  expect(out).not.toContain('log("dead")')
})

function runProgram(
  code: string,
  transform: (ast: File) => void,
): { logs: unknown[]; threw: string | null } {
  return trace(run(code, transform))
}

test('removeUnreachableCode keeps a TDZ-observable let after a return (F1)', () => {
  const src =
    "var q = 'outer'; function f() { return q; let q = 'inner'; } try { log(f()); } catch (e) { log(e.constructor.name); }"
  expect(runProgram(src, removeUnreachableCode)).toEqual(trace(src))
})

test('removeUnreachableCode keeps a nested var hoist inside a removed block (F2)', () => {
  const src =
    "function f() { var r; try { r = x } catch (e) { r = 'threw' } return r; { var x = 1 } } log(f());"
  expect(runProgram(src, removeUnreachableCode)).toEqual(trace(src))
})

test('removeUnreachableCode keeps a let observed only by a write before it', () => {
  const src =
    "function f() { try { x = 5; } catch (e) { return e.constructor.name; } return 'no throw'; let x = 2; } log(f());"
  expect(runProgram(src, removeUnreachableCode)).toEqual(trace(src))
})
