import { expect, test } from 'vitest'

import { dotToBracket } from 'src/preparation/dot-to-bracket'

import { defineCases, run } from '../helpers'

const cases = defineCases('dot-to-bracket', dotToBracket, {
  simpleDotAccess: {
    name: 'dotToBracket converts a single dot access to bracket access',
    input: `var v = obj.name;`,
  },
  chainedDotAccess: {
    name: 'dotToBracket converts a chain of dot accesses',
    input: `var v = obj.foo.bar;`,
  },
  assignmentTarget: {
    name: 'dotToBracket converts dot access used as an assignment target',
    input: `user.name = "x";`,
  },
  thisAccess: {
    name: 'dotToBracket converts dot access on this',
    input: `this.foo;`,
  },
  superAccess: {
    name: 'dotToBracket converts dot access on super',
    input: `class A extends B {
  m() {
    super.foo();
  }
}`,
  },
  optionalChain: {
    name: 'dotToBracket converts an optional dot access',
    input: `var v = maybe?.value;`,
  },
  alreadyComputedUntouched: {
    name: 'dotToBracket leaves an already-computed bracket access alone',
    input: `var v = obj["already"];`,
  },
  privateFieldUntouched: {
    name: 'dotToBracket leaves a private-field access alone',
    input: `class A {
  #x = 1;
  m() {
    return this.#x;
  }
}`,
  },
  deleteExpression: {
    name: 'dotToBracket converts dot access inside a delete expression',
    input: `delete obj.foo;`,
  },
  callOnDotAccess: {
    name: 'dotToBracket converts dot access on a method call',
    input: `obj.method(arg);`,
  },
})

test(cases.simpleDotAccess.name, () => {
  const out = run(cases.simpleDotAccess.input, dotToBracket)
  expect(out).toContain('obj["name"]')
})

test(cases.chainedDotAccess.name, () => {
  const out = run(cases.chainedDotAccess.input, dotToBracket)
  expect(out).toContain('obj["foo"]["bar"]')
})

test(cases.assignmentTarget.name, () => {
  const out = run(cases.assignmentTarget.input, dotToBracket)
  expect(out).toContain('user["name"] = "x"')
})

test(cases.thisAccess.name, () => {
  const out = run(cases.thisAccess.input, dotToBracket)
  expect(out).toContain('this["foo"]')
})

test(cases.superAccess.name, () => {
  const out = run(cases.superAccess.input, dotToBracket)
  expect(out).toContain('super["foo"]')
})

test(cases.optionalChain.name, () => {
  const out = run(cases.optionalChain.input, dotToBracket)
  expect(out).toContain('maybe?.["value"]')
})

test(cases.alreadyComputedUntouched.name, () => {
  const out = run(cases.alreadyComputedUntouched.input, dotToBracket)
  expect(out).toContain('obj["already"]')
  expect(out.match(/\["already"\]/g)?.length).toBe(1)
})

test(cases.privateFieldUntouched.name, () => {
  const out = run(cases.privateFieldUntouched.input, dotToBracket)
  expect(out).toContain('this.#x')
  expect(out).not.toContain('"#x"')
})

test(cases.deleteExpression.name, () => {
  const out = run(cases.deleteExpression.input, dotToBracket)
  expect(out).toContain('delete obj["foo"]')
})

test(cases.callOnDotAccess.name, () => {
  const out = run(cases.callOnDotAccess.input, dotToBracket)
  expect(out).toContain('obj["method"](arg)')
})
