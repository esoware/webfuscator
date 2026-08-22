import { parse } from '@babel/parser'
import { expect, test } from 'vitest'

import { collapseSingleUseTemps } from '../../src/transforms/collapse-single-use-temps'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('collapse-single-use-temps', collapseSingleUseTemps, {
  flavorAInitAdjacent: {
    name: 'flavor A: var X = expr; USE(X); collapses when adjacent',
    input: `function f(computeThing, process) {
  var t = computeThing();
  return process(t);
}`,
  },
  flavorAInitWithPureGap: {
    name: 'flavor A: collapses across a pure-init declaration in between',
    input: `function f(obj, process) {
  var t = obj.method();
  var k = 5;
  return process(t, k);
}`,
  },
  flavorAInitImpureGap: {
    name: 'flavor A: bails when an impure call sits between write and read',
    input: `function f() {
  var t = source();
  trigger();
  return process(t);
}`,
  },
  flavorAInitMultipleReads: {
    name: 'flavor A: bails when the binding is read more than once',
    input: `function f() {
  var t = compute();
  log(t);
  return t;
}`,
  },
  flavorAInitMultipleWrites: {
    name: 'flavor A: bails when the binding is reassigned',
    input: `function f() {
  var t = source();
  t = other();
  return t;
}`,
  },

  flavorASeparateWrite: {
    name: 'flavor A: var X; X = expr; USE(X); collapses when adjacent',
    input: `function f(compute, process) {
  var t;
  t = compute();
  return process(t);
}`,
  },
  flavorASeparateWriteCompoundOp: {
    name: 'flavor A: bails on compound assignment as the only write',
    input: `function f() {
  var t = 0;
  t += 5;
  return t;
}`,
  },

  flavorBLabeledBlock: {
    name: 'flavor B: rewrites writes inside a labeled block to the trailing-assignment target',
    input: `function f(cond) {
  var dest = init;
  var _t;
  _inlined: {
    if (cond) {
      _t = 1;
      break _inlined;
    }
    _t = 2;
    break _inlined;
  }
  dest = _t;
  log(dest);
  return dest;
}`,
  },
  flavorBYReadInSpan: {
    name: 'flavor B: bails when Y is read between the declarator and the trailing read',
    input: `function f(cond) {
  var dest = init;
  var _t;
  log(dest);
  if (cond) { _t = 1; } else { _t = 2; }
  dest = _t;
  log(dest);
  return dest;
}`,
  },
  flavorBSpanScattered: {
    name: 'flavor B: rewrites writes scattered across if/else branches',
    input: `function g(cond) {
  var out = 0;
  var _t;
  if (cond) {
    _t = 1;
  } else {
    _t = 2;
  }
  out = _t;
  log(out);
  return out;
}`,
  },

  cascade: {
    name: 'cascading: var a = X; var b = a; USE(b); collapses to USE(X);',
    input: `function f(source, process) {
  var a = source();
  var b = a;
  return process(b);
}`,
  },

  flavorAConst: {
    name: 'flavor A: collapses a single-use const initializer',
    input: `function f(computeThing, process) {
  const t = computeThing();
  return process(t);
}`,
  },
  flavorALet: {
    name: 'flavor A: collapses a single-use let initializer',
    input: `function f(computeThing, process) {
  let t = computeThing();
  return process(t);
}`,
  },

  multiDeclaratorPropagatesConstantsAndCascadesA: {
    name: 'flavor C handles per-declarator on a multi-declarator var; flavor A cascades',
    input: `function f(compute, process) {
  var t = compute(), k = 0;
  return process(t, k);
}`,
  },

  flavorCInitMultiRead: {
    name: 'flavor C: var X = lit; with multiple reads - substitute every read with the literal',
    input: `function f() {
  var TINT = 16711680;
  return process(TINT, TINT, TINT);
}`,
  },
  flavorCBarePackHoisted: {
    name: 'flavor C: bails on a read in a nested function that could run before the write',
    input: `(function () {
  var TINT;
  function paint(x) {
    return x ? TINT : 0;
  }
  TINT = 16711680;
  log(paint(true));
})();`,
  },
  flavorCConditionalWriteBails: {
    name: 'flavor C: bails when the write is inside an if (would promote undefined to lit)',
    input: `function f() {
  var X;
  if (cond) {
    X = 5;
  }
  log(X);
  log(X);
}`,
  },
  flavorCWriteInNestedFnBails: {
    name: 'flavor C: bails when the write is inside a nested function (write may not run)',
    input: `(function () {
  var X;
  function init() {
    X = 5;
  }
  function read() {
    return X;
  }
  read();
  init();
  read();
})();`,
  },
  bailExportedNotApplicable: {
    name: 'bails on a binding referenced 0 times (not single-use)',
    input: `function f() {
  var t = compute();
  return 0;
}`,
  },

  flavorDReturnIfElse: {
    name: 'flavor D: scattered writes feeding `return _t` become per-branch returns',
    input: `function f(cond) {
  var _t;
  if (cond) {
    _t = 1;
  } else {
    _t = 2;
  }
  return _t;
}`,
  },
  flavorDThrowIfElse: {
    name: 'flavor D: scattered writes feeding `throw _t` become per-branch throws',
    input: `function f(cond) {
  var _t;
  if (cond) {
    _t = new Error('a');
  } else {
    _t = new Error('b');
  }
  throw _t;
}`,
  },
  flavorDBailsOnInterveningStatement: {
    name: 'flavor D: bails when a statement sits between scatter-write and the terminator',
    input: `function f(cond) {
  var _t;
  if (cond) {
    _t = 1;
  } else {
    _t = 2;
  }
  log("between");
  return _t;
}`,
  },
  flavorDBailsOnNonTailWriteInBranch: {
    name: 'flavor D: bails when a branch has a non-tail write to _t',
    input: `function f(cond) {
  var _t;
  if (cond) {
    _t = 1;
    log("after write");
  } else {
    _t = 2;
  }
  return _t;
}`,
  },
})

test(cases.flavorAInitAdjacent.name, () => {
  const out = run(cases.flavorAInitAdjacent.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/var t/)
  expect(out).toMatch(/return process\(computeThing\(\)\)/)
  const harness = `
${out}
out.push(f(computeThing, process));
`
  const arr: unknown[] = []
  new Function('computeThing', 'process', 'out', harness)(
    () => 7,
    (v: number) => v * 2,
    arr,
  )
  expect(arr).toEqual([14])
})

test(cases.flavorAInitWithPureGap.name, () => {
  const out = run(cases.flavorAInitWithPureGap.input, collapseSingleUseTemps)
  // Both bindings have one write, one read, and a safe gap.
  expect(out).not.toMatch(/var t/)
  expect(out).not.toMatch(/var k/)
})

test(cases.flavorAInitImpureGap.name, () => {
  const out = run(cases.flavorAInitImpureGap.input, collapseSingleUseTemps)
  // `source()` cannot move past `trigger()`.
  expect(out).toMatch(/var t = source\(\)/)
  const calls: unknown[] = []
  new Function('source', 'trigger', 'process', 'out', `${out}\nout.push(f());`)(
    () => {
      calls.push('source')
      return 1
    },
    () => {
      calls.push('trigger')
    },
    (v: unknown) => {
      calls.push('process')
      return v
    },
    [],
  )
  expect(calls).toEqual(['source', 'trigger', 'process'])
})

test(cases.flavorAInitMultipleReads.name, () => {
  const out = run(cases.flavorAInitMultipleReads.input, collapseSingleUseTemps)
  expect(out).toMatch(/var t = compute\(\)/)
})

test(cases.flavorAInitMultipleWrites.name, () => {
  const out = run(cases.flavorAInitMultipleWrites.input, collapseSingleUseTemps)
  expect(out).toMatch(/var t = source\(\)/)
})

test(cases.flavorASeparateWrite.name, () => {
  const out = run(cases.flavorASeparateWrite.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/var t/)
  expect(out).not.toMatch(/^\s*t = /m)
  const harness = `
${out}
out.push(f(compute, process));
`
  const arr: unknown[] = []
  new Function('compute', 'process', 'out', harness)(
    () => 5,
    (v: number) => v + 1,
    arr,
  )
  expect(arr).toEqual([6])
})

test(cases.flavorASeparateWriteCompoundOp.name, () => {
  const out = run(cases.flavorASeparateWriteCompoundOp.input, collapseSingleUseTemps)
  expect(out).toMatch(/var t = 0/)
})

test(cases.flavorBLabeledBlock.name, () => {
  const out = run(cases.flavorBLabeledBlock.input, collapseSingleUseTemps)
  // The initialized and reassigned destination cannot use direct substitution.
  expect(out).not.toMatch(/_t/)
  expect(out).toMatch(/dest = 1/)
  expect(out).toMatch(/dest = 2/)
  const calls: unknown[] = []
  new Function('cond', 'init', 'log', 'out', `${out}\nout.push(f(cond));`)(
    true,
    7,
    (v: unknown) => calls.push(v),
    calls,
  )
  expect(calls).toEqual([1, 1])
})

test(cases.flavorBYReadInSpan.name, () => {
  const out = run(cases.flavorBYReadInSpan.input, collapseSingleUseTemps)
  // The intervening read observes the destination before redirection.
  expect(out).toMatch(/_t/)
})

test(cases.flavorBSpanScattered.name, () => {
  const out = run(cases.flavorBSpanScattered.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/_t/)
  expect(out).toMatch(/out = 1/)
  expect(out).toMatch(/out = 2/)
  const calls: unknown[] = []
  new Function('log', 'out', `${out}\nout.push(g(true), g(false));`)(
    (v: unknown) => calls.push(v),
    calls,
  )
  expect(calls).toEqual([1, 2, 1, 2])
})

test(cases.cascade.name, () => {
  const out = run(cases.cascade.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/var a/)
  expect(out).not.toMatch(/var b/)
  expect(out).toMatch(/return process\(source\(\)\)/)
})

test(cases.flavorAConst.name, () => {
  const out = run(cases.flavorAConst.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/const t/)
  expect(out).toMatch(/return process\(computeThing\(\)\)/)
})

test(cases.flavorALet.name, () => {
  const out = run(cases.flavorALet.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/let t/)
  expect(out).toMatch(/return process\(computeThing\(\)\)/)
})

test(cases.multiDeclaratorPropagatesConstantsAndCascadesA.name, () => {
  const out = run(
    cases.multiDeclaratorPropagatesConstantsAndCascadesA.input,
    collapseSingleUseTemps,
  )
  expect(out).toMatch(/return process\(compute\(\), 0\)/)
  expect(out).not.toMatch(/var t/)
  expect(out).not.toMatch(/var k/)
})

test(cases.flavorCInitMultiRead.name, () => {
  const out = run(cases.flavorCInitMultiRead.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/var TINT/)
  expect(out).toMatch(/return process\(16711680, 16711680, 16711680\)/)
})

test(cases.flavorCBarePackHoisted.name, () => {
  // Closure call order does not prove the write precedes this read.
  const out = run(cases.flavorCBarePackHoisted.input, collapseSingleUseTemps)
  expect(out).toMatch(/x \? TINT : 0/)
})

test(cases.flavorCConditionalWriteBails.name, () => {
  const out = run(cases.flavorCConditionalWriteBails.input, collapseSingleUseTemps)
  expect(out).toMatch(/var X/)
  expect(out).toMatch(/X = 5/)
  expect(out).toMatch(/log\(X\)/)
})

test(cases.flavorCWriteInNestedFnBails.name, () => {
  const out = run(cases.flavorCWriteInNestedFnBails.input, collapseSingleUseTemps)
  expect(out).toMatch(/var X/)
  expect(out).toMatch(/X = 5/)
})

test(cases.bailExportedNotApplicable.name, () => {
  const out = run(cases.bailExportedNotApplicable.input, collapseSingleUseTemps)
  // Zero-reference bindings belong to `removeUnusedCode`.
  expect(out).toMatch(/var t = compute\(\)/)
})

test(cases.flavorDReturnIfElse.name, () => {
  const out = run(cases.flavorDReturnIfElse.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/var _t/)
  expect(out).not.toMatch(/return _t/)
  expect(out).toMatch(/return 1/)
  expect(out).toMatch(/return 2/)
  const fn = new Function(`${out}\nreturn f;`)() as (cond: unknown) => unknown
  expect(fn(true)).toBe(1)
  expect(fn(false)).toBe(2)
})

test(cases.flavorDThrowIfElse.name, () => {
  const out = run(cases.flavorDThrowIfElse.input, collapseSingleUseTemps)
  expect(out).not.toMatch(/var _t/)
  expect(out).not.toMatch(/throw _t/)
  expect(out).toMatch(/throw new Error\('a'\)/)
  expect(out).toMatch(/throw new Error\('b'\)/)
  const fn = new Function(`${out}\nreturn f;`)() as (cond: unknown) => unknown
  expect(() => fn(true)).toThrow('a')
  expect(() => fn(false)).toThrow('b')
})

test(cases.flavorDBailsOnInterveningStatement.name, () => {
  const out = run(cases.flavorDBailsOnInterveningStatement.input, collapseSingleUseTemps)
  expect(out).toMatch(/var _t/)
  expect(out).toMatch(/return _t/)
})

test(cases.flavorDBailsOnNonTailWriteInBranch.name, () => {
  const out = run(cases.flavorDBailsOnNonTailWriteInBranch.input, collapseSingleUseTemps)
  expect(out).toMatch(/var _t/)
  expect(out).toMatch(/return _t/)
})

test('collapseSingleUseTemps returns false on a stable input', () => {
  const ast = parse(`function f() { return 1; }`, { sourceType: 'unambiguous' })
  expect(collapseSingleUseTemps(ast)).toBe(false)
})

test('collapseSingleUseTemps returns true on a single-pass collapse', () => {
  const ast = parse(`function f() { var t = 1; return t; }`, { sourceType: 'unambiguous' })
  expect(collapseSingleUseTemps(ast)).toBe(true)
  expect(collapseSingleUseTemps(ast)).toBe(false)
})

function collapsePreserves(code: string): void {
  expect(trace(run(code, collapseSingleUseTemps))).toEqual(trace(code))
}

test('collapse does not move a value past a side effect that changes it (F1)', () => {
  collapsePreserves('var i = 0; var a = [10, 20]; var t = a[i]; log(i = 1, t);')
})

test('collapse does not move a value into a short-circuited read (F2)', () => {
  collapsePreserves('function f() { log("f"); return 1; } var t = f(); false && log(t);')
})

test('collapse does not move a value into a loop header or param default (F3)', () => {
  collapsePreserves(
    'function f() { log("f"); return 2; } var t = f(); for (var i = 0; i < t; i++) { log(i); }',
  )
  collapsePreserves(
    'function f() { log("f"); return 1; } var t = f(); function g(a = t) { log(a); } g(); g();',
  )
})

test('collapse does not rebind this by substituting a member into a callee (F4)', () => {
  collapsePreserves('var o = { m: function () { log(this === o); } }; var t = o.m; t();')
})

test('collapse does not move a read past its binding let (F5 TDZ)', () => {
  collapsePreserves(
    'function f() { var t = x; let x = 1; return t; } try { log(f()); } catch (e) { log(e.constructor.name); }',
  )
})

test('collapse does not rename a non-dominating conditional write (F6)', () => {
  collapsePreserves(
    'function f(c) { var y = 1; var _t; if (c) { _t = 2; } y = _t; return y; } log(f(false));',
  )
})

test('collapse does not rename when the span indirectly observes the reader (F7)', () => {
  collapsePreserves(
    'function f() { function snap() { log(y); } var y = 1; var _t; _t = 2; snap(); y = _t; return y; } log(f());',
  )
})

test('collapse does not propagate a constant to a read before the write (F8)', () => {
  collapsePreserves('log(X); var X = 5;')
  collapsePreserves('var X; function r() { return X; } log(r()); X = 7; log(r());')
})

test('collapse does not move a write ahead of the reader binding declaration', () => {
  collapsePreserves(
    'function f(c) { var _t; _t = c ? 1 : 2; let y; y = _t; return y; } try { log(f(true)); } catch (e) { log(e.constructor.name); }',
  )
})

test('flavor B does not relocate writes past an intervening write to the reader (A02-01)', () => {
  const code =
    'var c = true; var y = 0; var _t; if (c) { _t = 1; } else { _t = 2; } y = 5; y = _t; log(y);'
  collapsePreserves(code)
  expect(run(code, collapseSingleUseTemps)).toMatch(/_t/)
})

test('flavor B does not relocate writes past a getter that observes the reader (A02-02)', () => {
  collapsePreserves(
    'var y = 0; var z = { get p() { log(y); return 0; } }; var c = true; var _t; if (c) { _t = 1; } else { _t = 2; } z.p; y = _t; log(y);',
  )
})

test('flavor B dominance rejects a labeled break that skips the write (A02-03)', () => {
  const code =
    'var c = true; var y = 0; var _t; lbl: { if (c) { break lbl; } _t = 1; } y = _t; log(y);'
  collapsePreserves(code)
  expect(run(code, collapseSingleUseTemps)).toMatch(/_t/)
})

test('flavor B does not relocate writes past a valueOf coercion that writes the reader (A02-04)', () => {
  collapsePreserves(
    'var y = 0; var z = 0; var COERCE = { valueOf: function () { log("coerce"); y = y + 100; return 2; } }; var _t; if (z === 0) { _t = 1; } else { _t = 2; } COERCE + 1; y = _t; log(y);',
  )
})

test('flavor A does not substitute into a for-in assignment target (A02-05)', () => {
  collapsePreserves(
    'var n = 0; function f() { n = n + 1; log("f"); return "k" + n; } var obj = { a: 1, b: 2 }; var o = {}; var t = f(); for (o[t] in obj) {} log(Object.keys(o).join("|"));',
  )
})

test('flavor A does not substitute into a for-of assignment target (A02-06)', () => {
  collapsePreserves(
    'var n = 0; function f() { n = n + 1; log("f"); return "k" + n; } var arr = [1, 2]; var o = {}; var t = f(); for (o[t] of arr) {} log(Object.keys(o).join("|"));',
  )
})

test('flavor A does not substitute an optional member into callee position (A02-14)', () => {
  collapsePreserves('var o = { m: function () { log(this === o); } }; var t = o?.m; t();')
})

test('flavor C does not propagate a constant to a hoisted function read before the write (A02-15)', () => {
  collapsePreserves('g(); var t = 1; function g() { log(t); }')
  collapsePreserves('g(); var t; t = 1; function g() { log(t); }')
})

test('collapse bails on a binding whose declaration or use sits inside a `with` (A09-12)', () => {
  const code =
    'var scope = { a: 0 }; var src = { a: 1 }; function fn() { with (scope) { var a = src.a; return a; } } log(fn(), scope.a);'
  collapsePreserves(code)
  expect(run(code, collapseSingleUseTemps)).toMatch(/var a = src\.a/)
})
