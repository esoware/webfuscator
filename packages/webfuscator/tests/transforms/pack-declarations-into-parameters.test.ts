import type { File } from '@babel/types'
import { expect, test } from 'vitest'

import { packDeclarationsIntoParameters } from '../../src/transforms/pack-declarations-into-parameters'
import { defineCases, run } from '../helpers'

const cases = defineCases('pack-declarations-into-parameters', packDeclarationsIntoParameters, {
  specPack: {
    name: 'packDeclarationsIntoParameters packs a leading literal-init var into a default parameter',
    input: `function run() {
  var x = 1;
  return x;
}`,
  },

  packMultiple: {
    name: 'packDeclarationsIntoParameters packs multiple consecutive leading literal-init vars',
    input: `function f() {
  var a = 1;
  var b = "two";
  var c = true;
  return a;
}`,
  },
  packStopsAtNonVar: {
    name: 'packDeclarationsIntoParameters stops packing at the first non-var statement',
    input: `function f() {
  var a = 1;
  log(a);
  var b = 2;
  return b;
}`,
  },
  packsCallExpressionInit: {
    name: 'packDeclarationsIntoParameters packs a call-init in the leading run (preserves source order)',
    input: `function f() {
  var a = 1;
  var b = compute();
  return a + b;
}`,
  },
  packsMemberExpressionInit: {
    name: 'packDeclarationsIntoParameters packs a member-expression init referencing an existing param',
    input: `function f(record, output) {
  var game = record.game;
  return [game, output];
}`,
  },
  bailsOnUnpackedBodyLocalReference: {
    name: 'packDeclarationsIntoParameters bails when an init references an unpacked body-local var',
    input: `function f() {
  var x = y;
  var y = 5;
  return x;
}`,
  },
  bailsOnYieldInInit: {
    name: 'packDeclarationsIntoParameters bails on a yield in a generator default-init candidate',
    input: `function* f() {
  var x = yield 1;
  return x;
}`,
  },
  bailsOnAwaitInInit: {
    name: 'packDeclarationsIntoParameters bails on an await in an async default-init candidate',
    input: `async function f() {
  var x = await load();
  return x;
}`,
  },
  nonLeadingVarWithInitStaysInPlace: {
    name: 'packDeclarationsIntoParameters leaves a non-leading var-with-init alone (no hoist)',
    input: `{
  log(1);
  var y = compute();
  log(y);
}`,
  },
  packAppendsAfterExistingParams: {
    name: 'packDeclarationsIntoParameters appends after existing params',
    input: `function f(a) {
  var b = 2;
  return a + b;
}`,
  },
  packSkipsRestParam: {
    name: 'packDeclarationsIntoParameters does not pack into a function with a rest parameter',
    input: `function f(...rest) {
  var a = 1;
  return a;
}`,
  },
  packSkipsCollidingName: {
    name: 'packDeclarationsIntoParameters skips a var whose name collides with an existing param',
    input: `function f(x) {
  var x = 1;
  return x;
}`,
  },
  packAcceptsUnaryNegation: {
    name: 'packDeclarationsIntoParameters packs a -N init',
    input: `function f() {
  var x = -5;
  return x;
}`,
  },

  packClassMethod: {
    name: 'packDeclarationsIntoParameters leaves a class method alone (its arity is observable)',
    input: `class A {
  m() {
    var x = 1;
    return x;
  }
}`,
  },
  packObjectMethod: {
    name: 'packDeclarationsIntoParameters leaves an object method alone (its arity is observable)',
    input: `var o = {
  m() {
    var x = 1;
    return x;
  }
};`,
  },
})

test(cases.specPack.name, () => {
  const out = run(cases.specPack.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/function run\(x = 1\)\s*\{\s*return x;\s*\}/)
  expect(out).not.toContain('var x = 1')
})

test(cases.nonLeadingVarWithInitStaysInPlace.name, () => {
  const out = run(cases.nonLeadingVarWithInitStaysInPlace.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/log\(1\);\s*var y = compute\(\);\s*log\(y\);/)
  expect(out).not.toMatch(/var y;/)
})

test(cases.packMultiple.name, () => {
  const out = run(cases.packMultiple.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/function f\(a = 1, b = "two", c = true\)/)
  expect(out).not.toContain('var ')
})

test(cases.packStopsAtNonVar.name, () => {
  const out = run(cases.packStopsAtNonVar.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/function f\(a = 1\)/)
  expect(out).toMatch(/var b = 2/)
})

test(cases.packsCallExpressionInit.name, () => {
  const out = run(cases.packsCallExpressionInit.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/function f\(a = 1\)/)
  expect(out).toMatch(/var b = compute\(\)/)
})

test(cases.packsMemberExpressionInit.name, () => {
  const out = run(cases.packsMemberExpressionInit.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/function f\(record, output\)/)
  expect(out).toMatch(/var game = record\.game/)
})

test(cases.bailsOnUnpackedBodyLocalReference.name, () => {
  const out = run(cases.bailsOnUnpackedBodyLocalReference.input, packDeclarationsIntoParameters)
  // Default-parameter scope cannot see body-local `y`.
  expect(out).toMatch(/var x = y/)
  expect(out).toMatch(/var y = 5/)
})

test(cases.bailsOnYieldInInit.name, () => {
  const out = run(cases.bailsOnYieldInInit.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/var x = yield 1/)
})

test(cases.bailsOnAwaitInInit.name, () => {
  const out = run(cases.bailsOnAwaitInInit.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/var x = await load\(\)/)
})

test(cases.packAppendsAfterExistingParams.name, () => {
  const out = run(cases.packAppendsAfterExistingParams.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/function f\(a, b = 2\)/)
})

test(cases.packSkipsRestParam.name, () => {
  const out = run(cases.packSkipsRestParam.input, packDeclarationsIntoParameters)
  expect(out).toContain('...rest')
  expect(out).toContain('var a = 1')
})

test(cases.packSkipsCollidingName.name, () => {
  const out = run(cases.packSkipsCollidingName.input, packDeclarationsIntoParameters)
  expect(out).toContain('function f(x)')
  expect(out).toContain('var x = 1')
})

test(cases.packAcceptsUnaryNegation.name, () => {
  const out = run(cases.packAcceptsUnaryNegation.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/function f\(x = -5\)/)
})

test(cases.packClassMethod.name, () => {
  const out = run(cases.packClassMethod.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/m\(\)/)
  expect(out).toContain('var x = 1')
})

test(cases.packObjectMethod.name, () => {
  const out = run(cases.packObjectMethod.input, packDeclarationsIntoParameters)
  expect(out).toMatch(/m\(\)/)
  expect(out).toContain('var x = 1')
})

test('packDeclarationsIntoParameters preserves runtime behavior of the spec example when called with no args', () => {
  const out = run(cases.specPack.input, packDeclarationsIntoParameters)
  const arr: unknown[] = []
  new Function('out', `${out}\nout.push(run());`)(arr)
  expect(arr).toEqual([1])
})

function preserves(code: string, transform: (ast: File) => void): void {
  const capture = (src: string): unknown[] => {
    const logs: unknown[] = []
    // oxlint-disable-next-line no-new-func
    new Function('log', src)((...a: unknown[]) => logs.push(a.length === 1 ? a[0] : a))
    return logs
  }
  expect(capture(run(code, transform))).toEqual(capture(code))
}

test('packDeclarationsIntoParameters does not pack when a caller passes extra args (F1)', () => {
  const out = run(
    'function f(a) { var x = 1; return x + a; }\nlog(f(0, 99));',
    packDeclarationsIntoParameters,
  )
  expect(out).toContain('var x = 1')
  preserves(
    'function f(a) { var x = 1; return x + a; }\nlog(f(0, 99));',
    packDeclarationsIntoParameters,
  )
})

test('packDeclarationsIntoParameters does not break a use-strict directive (F2)', () => {
  const out = run(
    "function f(a) { 'use strict'; var x = 1; return x; }",
    packDeclarationsIntoParameters,
  )
  expect(() => new Function(out)).not.toThrow()
})

test('packDeclarationsIntoParameters does not break a getter (F3)', () => {
  const out = run('var o = { get p() { var x = 1; return x; } };', packDeclarationsIntoParameters)
  expect(() => new Function(out)).not.toThrow()
  expect(out).toContain('get p()')
})

test('packDeclarationsIntoParameters does not unmap arguments (F4)', () => {
  preserves(
    'function f(a) { var x = 1; a = 42; return arguments[0]; }\nlog(f(1));',
    packDeclarationsIntoParameters,
  )
})

test('pack bails on duplicate sloppy params so output stays parseable (A02-16)', () => {
  const code = 'function f(a, a) { var x = 1; log(a, x); }\nf(1, 2);'
  const out = run(code, packDeclarationsIntoParameters)
  expect(() => new Function(out)).not.toThrow()
  expect(out).toContain('var x = 1')
  preserves(code, packDeclarationsIntoParameters)
})

test('pack respects arity of a recursive call through a named function-expression name (A02-17)', () => {
  const code = 'var f = function g(a) { var x = 1; if (a) { g(0, 99); } log(x); };\nf(1);'
  expect(run(code, packDeclarationsIntoParameters)).toContain('var x = 1')
  preserves(code, packDeclarationsIntoParameters)
})

test('pack does not pack an Annex-B block-level function declaration (A02-18)', () => {
  const code =
    'function outer() { { function h(a) { var x = 1; log(x, a); } } h(1, 2, 3); }\nouter();'
  expect(run(code, packDeclarationsIntoParameters)).toContain('var x = 1')
  preserves(code, packDeclarationsIntoParameters)
})

test('pack does not pack a var sharing a name with a body function declaration (A02-19)', () => {
  const code = 'function f() { var x = 1; log(typeof x); function x() {} }\nf();'
  expect(run(code, packDeclarationsIntoParameters)).toContain('var x = 1')
  preserves(code, packDeclarationsIntoParameters)
})

test('pack does not unmap arguments observed through a direct eval (A02-20)', () => {
  const code = 'function f(a) { var x = 1; a = 9; log(eval("arguments[0]"), x); }\nf(7);'
  expect(run(code, packDeclarationsIntoParameters)).toContain('var x = 1')
  preserves(code, packDeclarationsIntoParameters)
})

test('pack detects arguments read in a nested method computed key (A02-21)', () => {
  const code =
    'function f(a) { var x = 1; a = 9; var o = { [arguments[0]]() { return "m"; } }; log(Object.keys(o), x); }\nf(7);'
  expect(run(code, packDeclarationsIntoParameters)).toContain('var x = 1')
  preserves(code, packDeclarationsIntoParameters)
})
