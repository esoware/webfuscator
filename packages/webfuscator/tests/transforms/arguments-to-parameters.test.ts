import { expect, test } from 'vitest'

import { argumentsToParameters } from '../../src/transforms/arguments-to-parameters'
import { defineCases, run } from '../helpers'

const cases = defineCases('arguments-to-parameters', argumentsToParameters, {
  specExample: {
    name: 'argumentsToParameters substitutes an in-range index and leaves an out-of-range one',
    input: `function foo(bar) {
  log(arguments[0]);
  log(arguments[1]);
}`,
  },
  noParams: {
    name: 'argumentsToParameters does not synthesize parameters (fn.length is observable)',
    input: `function f() {
  return arguments[0] + arguments[1];
}`,
  },
  matchesExistingParam: {
    name: 'argumentsToParameters reuses an existing identifier param when its index is read',
    input: `function f(a) {
  return arguments[0];
}`,
  },
  multipleReadsSameIndex: {
    name: 'argumentsToParameters substitutes every read of the same in-range index',
    input: `function f(a) {
  log(arguments[0]);
  log(arguments[0]);
}`,
  },
  insideArrowChild: {
    name: 'argumentsToParameters substitutes arguments inside a nested arrow (which inherits)',
    input: `function f(a) {
  return () => arguments[0];
}`,
  },
  nestedFunctionUsesOwnArguments: {
    name: 'argumentsToParameters resolves nested non-arrow arguments against the inner function, not the outer',
    input: `function outer(a) {
  function inner() {
    return arguments[0];
  }
  return inner;
}`,
  },
  leavesArrowAlone: {
    name: 'argumentsToParameters does not change a top-level arrow function',
    input: `var fn = (a) => arguments[0];`,
  },
  leavesShadowedArguments: {
    name: 'argumentsToParameters does not substitute when arguments is locally shadowed',
    input: `function f() {
  var arguments = [1, 2, 3];
  return arguments[0];
}`,
  },
  leavesRestParamFunctionAlone: {
    name: 'argumentsToParameters skips functions that already use a rest parameter',
    input: `function f(...rest) {
  return arguments[0];
}`,
  },
  leavesAssignmentTarget: {
    name: 'argumentsToParameters does not substitute any read of a written index',
    input: `function f(a) {
  arguments[0] = 1;
  return arguments[0];
}`,
  },
  leavesUpdateExpression: {
    name: 'argumentsToParameters does not substitute update expressions on arguments[i]',
    input: `function f(a) {
  arguments[0]++;
  return a;
}`,
  },
  leavesNonNumericAccess: {
    name: 'argumentsToParameters does not touch non-numeric arguments accesses',
    input: `function f(a) {
  return arguments["length"];
}`,
  },
  leavesPatternParam: {
    name: 'argumentsToParameters skips an index whose existing param is a destructuring pattern',
    input: `function f({ a }, b) {
  return arguments[0] + arguments[1];
}`,
  },
  leavesDefaultedParam: {
    name: 'argumentsToParameters skips an index whose existing param has a default value',
    input: `function f(a = 1) {
  return arguments[0];
}`,
  },
  classMethod: {
    name: 'argumentsToParameters leaves a class method alone (strict, unmapped arguments)',
    input: `class A {
  m() {
    return arguments[0];
  }
}`,
  },
  objectMethod: {
    name: 'argumentsToParameters leaves an object method with no matching param alone',
    input: `var o = {
  m() {
    return arguments[0];
  }
};`,
  },
  generatorFunction: {
    name: 'argumentsToParameters does not synthesize a param for a generator',
    input: `function* g() {
  yield arguments[0];
}`,
  },
})

test(cases.specExample.name, () => {
  const out = run(cases.specExample.input, argumentsToParameters)
  expect(out).toContain('function foo(bar)')
  expect(out).toContain('log(bar)')
  expect(out).toContain('log(arguments[1])')
  expect(out).not.toContain('arguments[0]')
})

test(cases.noParams.name, () => {
  const out = run(cases.noParams.input, argumentsToParameters)
  expect(out).toContain('return arguments[0] + arguments[1]')
  expect(out).toMatch(/function f\(\)/)
})

test(cases.matchesExistingParam.name, () => {
  const out = run(cases.matchesExistingParam.input, argumentsToParameters)
  expect(out).toContain('function f(a)')
  expect(out).toContain('return a')
  expect(out).not.toContain('arguments[0]')
})

test(cases.multipleReadsSameIndex.name, () => {
  const out = run(cases.multipleReadsSameIndex.input, argumentsToParameters)
  expect(out).not.toContain('arguments[0]')
  expect(out.match(/log\(a\)/g)?.length).toBe(2)
})

test(cases.insideArrowChild.name, () => {
  const out = run(cases.insideArrowChild.input, argumentsToParameters)
  expect(out).toContain('return () => a')
  expect(out).not.toContain('arguments[0]')
})

test(cases.nestedFunctionUsesOwnArguments.name, () => {
  const out = run(cases.nestedFunctionUsesOwnArguments.input, argumentsToParameters)
  expect(out).toContain('function outer(a)')
  // The inner function has no parameter at index zero.
  expect(out).toContain('return arguments[0]')
})

test(cases.leavesArrowAlone.name, () => {
  const out = run(cases.leavesArrowAlone.input, argumentsToParameters)
  expect(out).toContain('arguments[0]')
})

test(cases.leavesShadowedArguments.name, () => {
  const out = run(cases.leavesShadowedArguments.input, argumentsToParameters)
  expect(out).toContain('var arguments')
  expect(out).toContain('return arguments[0]')
})

test(cases.leavesRestParamFunctionAlone.name, () => {
  const out = run(cases.leavesRestParamFunctionAlone.input, argumentsToParameters)
  expect(out).toContain('...rest')
  expect(out).toContain('return arguments[0]')
})

test(cases.leavesAssignmentTarget.name, () => {
  // A missing argument has no mapping, so an index write does not update `a`.
  const out = run(cases.leavesAssignmentTarget.input, argumentsToParameters)
  expect(out).toContain('arguments[0] = 1')
  expect(out).toContain('return arguments[0]')
})

test(cases.leavesUpdateExpression.name, () => {
  const out = run(cases.leavesUpdateExpression.input, argumentsToParameters)
  expect(out).toContain('arguments[0]++')
})

test(cases.leavesNonNumericAccess.name, () => {
  const out = run(cases.leavesNonNumericAccess.input, argumentsToParameters)
  expect(out).toContain('arguments["length"]')
})

test(cases.leavesPatternParam.name, () => {
  const out = run(cases.leavesPatternParam.input, argumentsToParameters)
  // Destructuring makes the parameter list non-simple and unmapped.
  expect(out).toContain('arguments[0] + arguments[1]')
})

test(cases.leavesDefaultedParam.name, () => {
  const out = run(cases.leavesDefaultedParam.input, argumentsToParameters)
  expect(out).toContain('arguments[0]')
})

test(cases.classMethod.name, () => {
  const out = run(cases.classMethod.input, argumentsToParameters)
  expect(out).toMatch(/m\(\)/)
  expect(out).toContain('return arguments[0]')
})

test(cases.objectMethod.name, () => {
  const out = run(cases.objectMethod.input, argumentsToParameters)
  expect(out).toMatch(/m\(\)/)
  expect(out).toContain('return arguments[0]')
})

test(cases.generatorFunction.name, () => {
  const out = run(cases.generatorFunction.input, argumentsToParameters)
  expect(out).toMatch(/function\*\s*g\(\)/)
  expect(out).toContain('yield arguments[0]')
})

function preservesArgs(code: string): void {
  const capture = (src: string): unknown[] => {
    const logs: unknown[] = []
    // oxlint-disable-next-line no-new-func
    new Function('log', src)((...a: unknown[]) => logs.push(a.length === 1 ? a[0] : a))
    return logs
  }
  expect(capture(run(code, argumentsToParameters))).toEqual(capture(code))
}

test('argumentsToParameters preserves fn.length (F5)', () => {
  preservesArgs('function f() { return arguments[0]; }\nlog(f.length);')
})

test('argumentsToParameters does not substitute in strict mode (F7)', () => {
  preservesArgs("var f = function (a) { 'use strict'; a = 9; return arguments[0]; };\nlog(f(1));")
})

test('argumentsToParameters does not break delete arguments (F8, F9)', () => {
  const out = run(
    'function f(a, b) { return delete arguments[0]; }\nlog(f());',
    argumentsToParameters,
  )
  expect(() => new Function(out)).not.toThrow()
  preservesArgs('function f(a) { delete arguments[0]; return arguments[0]; }\nlog(f(1));')
})

test('argumentsToParameters does not substitute through a duplicated parameter name', () => {
  // Only the last index of a duplicate parameter name is mapped.
  preservesArgs('function f(a, a) { return arguments[0]; }\nlog(f(1, 2));')
})

test('argumentsToParameters does not substitute a reassigned parameter (A01-13)', () => {
  const code = 'function f(a) { a = 5; return arguments[0]; }\nlog(f());\nlog(f(1));'
  const out = run(code, argumentsToParameters)
  // Without an argument, assigning `a` does not update `arguments[0]`.
  expect(out).toContain('arguments[0]')
  preservesArgs(code)
})

test('argumentsToParameters does not substitute a reassigned parameter read in an arrow (A01-13b)', () => {
  const code =
    'function f(a) { var g = () => arguments[0]; a = 9; return g(); }\nlog(f(1));\nlog(f());'
  const out = run(code, argumentsToParameters)
  expect(out).toContain('arguments[0]')
  preservesArgs(code)
})

test('argumentsToParameters does not substitute when Object.freeze(arguments) escapes it (A01-14)', () => {
  const code = 'function f(a) { Object.freeze(arguments); a = 5; return arguments[0]; }\nlog(f(1));'
  const out = run(code, argumentsToParameters)
  expect(out).toContain('arguments[0]')
  preservesArgs(code)
})

test('argumentsToParameters does not substitute when arguments escapes to a callee (A01-15)', () => {
  const code =
    'function h(args) { delete args[0]; }\nfunction f(a) { h(arguments); return arguments[0]; }\nlog(f(1));'
  const out = run(code, argumentsToParameters)
  expect(out).toContain('return arguments[0]')
  preservesArgs(code)
})

test('argumentsToParameters does not substitute a read of a written index (A01-13c)', () => {
  const code =
    'function f(a) { arguments[0] = 5; return [a, arguments[0]]; }\nlog(f(1));\nlog(f());'
  const out = run(code, argumentsToParameters)
  expect(out).toContain('arguments[0] = 5')
  expect(out).toContain('arguments[0]]')
  preservesArgs(code)
})
