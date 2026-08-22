import { parse } from '@babel/parser'
import { expect, test } from 'vitest'

import { inlineFunctions } from '../../src/transforms/inline-functions'
import { defineCases, run } from '../helpers'

const cases = defineCases('inline-functions', inlineFunctions, {
  voidFunctionStatementCall: {
    name: 'inlineFunctions splices a void-returning function and replaces the call with void 0',
    input: `function greet() {
  log("hi");
}
greet();`,
  },

  trailingReturnInVarInit: {
    name: 'inlineFunctions inlines a trailing-return function into a variable initializer',
    input: `function pure(x) {
  return x + 1;
}
var v = pure(5);`,
  },
  trailingReturnInExpression: {
    name: 'inlineFunctions inlines a trailing-return function used inside an expression',
    input: `function add(a, b) {
  return a + b;
}
log(add(1, 2));`,
  },

  earlyReturnLabelFallback: {
    name: 'inlineFunctions falls back to a labeled block when an early return exists',
    input: `function pick(x) {
  if (x) {
    return 1;
  }
  return 2;
}
var v = pick(cond);`,
  },

  multipleCallSites: {
    name: 'inlineFunctions inlines every call site of a single candidate',
    input: `function double(n) {
  return n * 2;
}
var a = double(1);
var b = double(2);`,
  },

  readOnlyParamElided: {
    name: 'inlineFunctions reuses the argument name when a read-only param is fed an Identifier arg',
    input: `function f(x) {
  return x + 1;
}
var k = 7;
var v = f(k);`,
  },
  reassignedParamKeptAsVar: {
    name: 'inlineFunctions allocates a fresh binding when the param is reassigned in the body',
    input: `function f(x) {
  x = x + 1;
  return x;
}
var k = 7;
var v = f(k);`,
  },

  extraArgsKeptAsExpressionStatements: {
    name: 'inlineFunctions evaluates extra-arity arguments before the inlined body',
    input: `function f(x) {
  log(x);
}
f(1, side1(), side2());`,
  },

  recursiveFunctionUntouched: {
    name: 'inlineFunctions does not inline a recursive function',
    input: `function fact(n) {
  return n <= 1 ? 1 : n * fact(n - 1);
}
var v = fact(5);`,
  },
  thisRefBail: {
    name: 'inlineFunctions does not inline a function that reads this',
    input: `function m() {
  return this.x;
}
var v = m();`,
  },
  argumentsRefBail: {
    name: 'inlineFunctions does not inline a function that reads arguments',
    input: `function f() {
  return arguments[0];
}
var v = f(1);`,
  },
  closureCaptureBail: {
    name: 'inlineFunctions does not inline a function whose nested closure captures one of its locals',
    input: `function outer() {
  var local = 1;
  return function () {
    return local;
  };
}
var fn = outer();`,
  },
  spreadArgumentBail: {
    name: 'inlineFunctions does not inline when a call site uses a spread argument',
    input: `function f(a, b) {
  return a + b;
}
var v = f(...args);`,
  },
  passedAsValueBail: {
    name: 'inlineFunctions does not inline when the function is referenced other than as a callee',
    input: `function f() {
  return 1;
}
var ref = f;
ref();`,
  },
  unsafeExpressionPositionBail: {
    name: 'inlineFunctions does not inline a call on the right of && (would change short-circuiting)',
    input: `function helper() {
  return 1;
}
var v = cond && helper();`,
  },
  ternaryBranchBail: {
    name: 'inlineFunctions does not inline a call inside a ternary branch',
    input: `function helper() {
  return 1;
}
var v = cond ? helper() : 0;`,
  },
  argsThisInExpressionContext: {
    name: 'inlineFunctions does not inline when the args read this and the call is not the whole statement',
    input: `function f(x) {
  return x;
}
var obj = { run: function () { return 1 + f(this.value); } };`,
  },

  nestedCandidateInArgsResolves: {
    name: 'inlineFunctions inlines an outer call after the inner candidate-call argument is itself inlined',
    input: `function inner(n) {
  return n + 1;
}
function outer(n) {
  return n * 2;
}
var v = outer(inner(3));`,
  },

  argEvaluatedExactlyOnce: {
    name: 'inlineFunctions evaluates a side-effectful argument exactly once',
    input: `function twice(x) {
  return x + x;
}
var v = twice(side());`,
  },

  preservesCandidateWhenAnotherInlinedBodyClonedItsCalls: {
    name: 'inlineFunctions does not remove a candidate whose calls were cloned into another inlined body',
    input: `function boot() {
  arr.forEach(function (item) {
    sink(merge(item));
  });
}
function merge(item) {
  return item.a;
}
boot();
boot();`,
  },

  doesNotHoistCallOutOfDefaultParameter: {
    name: 'inlineFunctions does not hoist a candidate-call out of an AssignmentPattern default value',
    input: `function compute(x) {
  return x.a;
}
function f(target, asBot = compute(target)) {
  return asBot;
}
var v1 = f({ a: 7 });
var v2 = f({ a: 9 }, 99);`,
  },

  directVarInitTrailing: {
    name: 'inlineFunctions writes a trailing return straight into a bare-ident var initializer',
    input: `function add(a, b) {
  return a + b;
}
var v = add(1, 2);`,
  },
  directAssignTrailing: {
    name: 'inlineFunctions writes a trailing return straight into a bare-ident assignment statement',
    input: `function add(a, b) {
  return a + b;
}
var v;
v = add(1, 2);`,
  },
  directVarInitComplex: {
    name: 'inlineFunctions writes a complex-return body straight into a bare-ident var initializer',
    input: `function pick(x) {
  if (x) {
    return 1;
  }
  return 2;
}
var v = pick(cond);`,
  },
  directAssignComplex: {
    name: 'inlineFunctions writes a complex-return body straight into a bare-ident assignment statement',
    input: `function pick(x) {
  if (x) {
    return 1;
  }
  return 2;
}
var v;
v = pick(cond);`,
  },
  noDirectForMemberLhs: {
    name: 'inlineFunctions keeps the temp when the call sits in a member-LHS assignment',
    input: `function add(a, b) {
  return a + b;
}
var obj = {};
obj.x = add(1, 2);`,
  },
  noDirectForMultiDeclarator: {
    name: 'inlineFunctions keeps the temp when the var declares multiple identifiers',
    input: `function add(a, b) {
  return a + b;
}
var v = add(1, 2), w = 0;`,
  },
  noDirectForForInitDeclarator: {
    name: 'inlineFunctions keeps the temp when the declarator sits in a for-init slot',
    input: `function start() {
  return 0;
}
for (var i = start(); i < 3; i++) {
  log(i);
}`,
  },
  directAvoidsTargetInArgs: {
    name: 'inlineFunctions does not specialize when the destination ident is also passed as an arg',
    input: `function bump(n) {
  if (n < 0) {
    return 0;
  }
  return n + 1;
}
var v = 5;
v = bump(v);`,
  },

  ifElseAtTailNeedsNoLabel: {
    name: 'inlineFunctions skips the labeled block when every return is at structural tail (if/else)',
    input: `function pick(x) {
  if (x) {
    return 1;
  } else {
    return 2;
  }
}
var v = pick(cond);`,
  },
  nestedIfsAtTailNeedNoLabel: {
    name: 'inlineFunctions skips the labeled block when nested ifs are all at tail',
    input: `function classify(x) {
  if (x > 10) {
    if (x > 100) {
      return "big";
    } else {
      return "medium";
    }
  } else {
    return "small";
  }
}
var v = classify(n);`,
  },

  earlyReturnInsideForLoop: {
    name: 'inlineFunctions maps an early return inside a for-loop to a break out of the labeled block',
    input: `function findFirst(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] > 0) {
      return arr[i];
    }
  }
  return -1;
}
var v = findFirst(data);`,
  },
  returnInsideTryFinally: {
    name: 'inlineFunctions preserves try/catch/finally semantics when a return is inlined',
    input: `function attempt(x) {
  try {
    return x.value;
  } catch (e) {
    return -1;
  } finally {
    log("done");
  }
}
var ok = attempt({ value: 42 });
var bad = attempt(null);`,
  },
  returnInsideSwitch: {
    name: 'inlineFunctions maps returns inside switch cases to breaks out of the labeled block',
    input: `function classify(n) {
  switch (n) {
    case 0:
      return "zero";
    case 1:
      return "one";
    default:
      return "many";
  }
}
var a = classify(0);
var b = classify(1);
var c = classify(5);`,
  },
  returnInsideLabeledLoop: {
    name: 'inlineFunctions walks a labeled loop body when mapping an early return',
    input: `function firstMatch(rows) {
  scan: for (var i = 0; i < rows.length; i++) {
    if (rows[i] === target) {
      return i;
    }
  }
  return -1;
}
var idx = firstMatch(data);`,
  },
})

test(cases.voidFunctionStatementCall.name, () => {
  const out = run(cases.voidFunctionStatementCall.input, inlineFunctions)
  expect(out).not.toMatch(/function greet/)
  expect(out).not.toContain('greet()')
  const calls: unknown[] = []
  new Function('log', out)((v: unknown) => calls.push(v))
  expect(calls).toEqual(['hi'])
})

test(cases.trailingReturnInVarInit.name, () => {
  const out = run(cases.trailingReturnInVarInit.input, inlineFunctions)
  expect(out).not.toMatch(/function pure/)
  const v = new Function(`${out}\nreturn v;`)() as number
  expect(v).toBe(6)
})

test(cases.trailingReturnInExpression.name, () => {
  const out = run(cases.trailingReturnInExpression.input, inlineFunctions)
  const calls: unknown[] = []
  new Function('log', out)((v: unknown) => calls.push(v))
  expect(calls).toEqual([3])
})

test(cases.earlyReturnLabelFallback.name, () => {
  const out = run(cases.earlyReturnLabelFallback.input, inlineFunctions)
  expect(out).not.toMatch(/function pick/)
  expect(out).toMatch(/^\s*\w+:\s*\{[\s\S]*break /m)
  expect(new Function('cond', `${out}\nreturn v;`)(true)).toBe(1)
  expect(new Function('cond', `${out}\nreturn v;`)(false)).toBe(2)
})

test(cases.multipleCallSites.name, () => {
  const out = run(cases.multipleCallSites.input, inlineFunctions)
  expect(out).not.toMatch(/function double/)
  expect(new Function(`${out}\nreturn [a, b];`)()).toEqual([2, 4])
})

test(cases.readOnlyParamElided.name, () => {
  const out = run(cases.readOnlyParamElided.input, inlineFunctions)
  expect(out).not.toMatch(/function f/)
  expect(out).not.toMatch(/var \w+ = k;/)
  expect(new Function(`${out}\nreturn v;`)()).toBe(8)
})

test(cases.reassignedParamKeptAsVar.name, () => {
  const out = run(cases.reassignedParamKeptAsVar.input, inlineFunctions)
  expect(out).not.toMatch(/function f/)
  // Parameter reassignment must not write through to the caller's `k`.
  const ctx = new Function(`${out}\nreturn { v: v, k: k };`)() as { v: number; k: number }
  expect(ctx.v).toBe(8)
  expect(ctx.k).toBe(7)
})

test(cases.extraArgsKeptAsExpressionStatements.name, () => {
  const out = run(cases.extraArgsKeptAsExpressionStatements.input, inlineFunctions)
  const calls: unknown[] = []
  new Function('side1', 'side2', 'log', out)(
    () => calls.push('side1'),
    () => calls.push('side2'),
    (x: unknown) => calls.push(`log:${x}`),
  )
  expect(calls).toEqual(['side1', 'side2', 'log:1'])
})

test(cases.recursiveFunctionUntouched.name, () => {
  const out = run(cases.recursiveFunctionUntouched.input, inlineFunctions)
  expect(out).toContain('function fact')
  expect(out).toContain('fact(n - 1)')
  expect(out).toContain('fact(5)')
})

test(cases.thisRefBail.name, () => {
  const out = run(cases.thisRefBail.input, inlineFunctions)
  expect(out).toContain('function m')
  expect(out).toContain('m()')
})

test(cases.argumentsRefBail.name, () => {
  const out = run(cases.argumentsRefBail.input, inlineFunctions)
  expect(out).toContain('function f')
  expect(out).toContain('f(1)')
})

test(cases.closureCaptureBail.name, () => {
  const out = run(cases.closureCaptureBail.input, inlineFunctions)
  expect(out).toContain('function outer')
  expect(out).toContain('outer()')
})

test(cases.spreadArgumentBail.name, () => {
  const out = run(cases.spreadArgumentBail.input, inlineFunctions)
  expect(out).toContain('function f')
  expect(out).toContain('f(...args)')
})

test(cases.passedAsValueBail.name, () => {
  const out = run(cases.passedAsValueBail.input, inlineFunctions)
  expect(out).toContain('function f')
  expect(out).toContain('var ref = f')
  expect(out).toContain('ref()')
})

test(cases.unsafeExpressionPositionBail.name, () => {
  const out = run(cases.unsafeExpressionPositionBail.input, inlineFunctions)
  expect(out).toContain('function helper')
  expect(out).toContain('cond && helper()')
})

test(cases.ternaryBranchBail.name, () => {
  const out = run(cases.ternaryBranchBail.input, inlineFunctions)
  expect(out).toContain('function helper')
  expect(out).toContain('cond ? helper() : 0')
})

test(cases.argsThisInExpressionContext.name, () => {
  const out = run(cases.argsThisInExpressionContext.input, inlineFunctions)
  expect(out).toContain('function f')
  expect(out).toContain('f(this.value)')
})

test(cases.nestedCandidateInArgsResolves.name, () => {
  const out = run(cases.nestedCandidateInArgsResolves.input, inlineFunctions)
  expect(out).not.toMatch(/function inner/)
  expect(out).not.toMatch(/function outer/)
  expect(new Function(`${out}\nreturn v;`)()).toBe(8)
})

test(cases.argEvaluatedExactlyOnce.name, () => {
  const out = run(cases.argEvaluatedExactlyOnce.input, inlineFunctions)
  expect(out).not.toMatch(/function twice/)
  let calls = 0
  const v = new Function('side', `${out}\nreturn v;`)(() => {
    calls++
    return 5
  }) as number
  expect(v).toBe(10)
  expect(calls).toBe(1)
})

test(cases.preservesCandidateWhenAnotherInlinedBodyClonedItsCalls.name, () => {
  const out = run(
    cases.preservesCandidateWhenAnotherInlinedBodyClonedItsCalls.input,
    inlineFunctions,
  )
  // Bottom-up traversal may inline `merge` again inside a newly spliced body.
  const records: unknown[] = []
  new Function('arr', 'sink', out)([{ a: 1 }, { a: 2 }, { a: 3 }], (v: unknown) => records.push(v))
  expect(records).toEqual([1, 2, 3, 1, 2, 3])
})

test(cases.doesNotHoistCallOutOfDefaultParameter.name, () => {
  const out = run(cases.doesNotHoistCallOutOfDefaultParameter.input, inlineFunctions)
  expect(out).toMatch(/function f\(target,\s*asBot\s*=/)
  const ctx = new Function(`${out}\nreturn { v1: v1, v2: v2 };`)() as {
    v1: number
    v2: number
  }
  expect(ctx).toEqual({ v1: 7, v2: 99 })
})

test('inlineFunctions returns false on a second call once nothing remains to inline', () => {
  const ast = parse(
    `function helper(x) { return x + 1; }
function caller() { return helper(2) + helper(3); }
caller();`,
    { sourceType: 'unambiguous' },
  )
  expect(inlineFunctions(ast)).toBe(true)
  expect(inlineFunctions(ast)).toBe(false)
})

test(cases.directVarInitTrailing.name, () => {
  const out = run(cases.directVarInitTrailing.input, inlineFunctions)
  expect(out).not.toMatch(/_returnValue/)
  expect(out).not.toMatch(/function add/)
  expect(new Function(`${out}\nreturn v;`)()).toBe(3)
})

test(cases.directAssignTrailing.name, () => {
  const out = run(cases.directAssignTrailing.input, inlineFunctions)
  expect(out).not.toMatch(/_returnValue/)
  expect(out).not.toMatch(/function add/)
  expect(new Function(`${out}\nreturn v;`)()).toBe(3)
})

test(cases.directVarInitComplex.name, () => {
  const out = run(cases.directVarInitComplex.input, inlineFunctions)
  expect(out).not.toMatch(/_returnValue/)
  expect(out).not.toMatch(/function pick/)
  expect(out).toMatch(/^\s*\w+:\s*\{/m)
  expect(new Function('cond', `${out}\nreturn v;`)(true)).toBe(1)
  expect(new Function('cond', `${out}\nreturn v;`)(false)).toBe(2)
})

test(cases.directAssignComplex.name, () => {
  const out = run(cases.directAssignComplex.input, inlineFunctions)
  // A plain target needs a temp to preserve fall-through `undefined` and retain
  // its old value when the body throws.
  expect(out).toMatch(/_returnValue/)
  expect(out).not.toMatch(/function pick/)
  expect(new Function('cond', `${out}\nreturn v;`)(true)).toBe(1)
  expect(new Function('cond', `${out}\nreturn v;`)(false)).toBe(2)
})

test(cases.noDirectForMemberLhs.name, () => {
  const out = run(cases.noDirectForMemberLhs.input, inlineFunctions)
  expect(out).toMatch(/_returnValue/)
  expect(new Function(`${out}\nreturn obj.x;`)()).toBe(3)
})

test(cases.noDirectForMultiDeclarator.name, () => {
  const out = run(cases.noDirectForMultiDeclarator.input, inlineFunctions)
  expect(out).toMatch(/_returnValue/)
  const ctx = new Function(`${out}\nreturn { v: v, w: w };`)() as { v: number; w: number }
  expect(ctx).toEqual({ v: 3, w: 0 })
})

test(cases.noDirectForForInitDeclarator.name, () => {
  const out = run(cases.noDirectForForInitDeclarator.input, inlineFunctions)
  expect(out).toMatch(/_returnValue/)
  const calls: unknown[] = []
  new Function('log', out)((v: unknown) => calls.push(v))
  expect(calls).toEqual([0, 1, 2])
})

test(cases.directAvoidsTargetInArgs.name, () => {
  const out = run(cases.directAvoidsTargetInArgs.input, inlineFunctions)
  expect(out).toMatch(/_returnValue/)
  expect(new Function(`${out}\nreturn v;`)()).toBe(6)
})

test(cases.ifElseAtTailNeedsNoLabel.name, () => {
  const out = run(cases.ifElseAtTailNeedsNoLabel.input, inlineFunctions)
  expect(out).not.toMatch(/function pick/)
  expect(out).not.toMatch(/break /)
  expect(out).not.toMatch(/^\s*\w+:\s*\{/m)
  expect(new Function('cond', `${out}\nreturn v;`)(true)).toBe(1)
  expect(new Function('cond', `${out}\nreturn v;`)(false)).toBe(2)
})

test(cases.nestedIfsAtTailNeedNoLabel.name, () => {
  const out = run(cases.nestedIfsAtTailNeedNoLabel.input, inlineFunctions)
  expect(out).not.toMatch(/function classify/)
  expect(out).not.toMatch(/break /)
  expect(out).not.toMatch(/^\s*\w+:\s*\{/m)
  expect(new Function('n', `${out}\nreturn v;`)(150)).toBe('big')
  expect(new Function('n', `${out}\nreturn v;`)(50)).toBe('medium')
  expect(new Function('n', `${out}\nreturn v;`)(5)).toBe('small')
})

test(cases.earlyReturnInsideForLoop.name, () => {
  const out = run(cases.earlyReturnInsideForLoop.input, inlineFunctions)
  expect(out).not.toMatch(/function findFirst/)
  expect(new Function('data', `${out}\nreturn v;`)([-3, -1, 4, 9])).toBe(4)
  expect(new Function('data', `${out}\nreturn v;`)([-3, -1])).toBe(-1)
})

test(cases.returnInsideTryFinally.name, () => {
  const out = run(cases.returnInsideTryFinally.input, inlineFunctions)
  expect(out).not.toMatch(/function attempt/)
  const logged: unknown[] = []
  const ctx = new Function('log', `${out}\nreturn { ok: ok, bad: bad };`)((v: unknown) =>
    logged.push(v),
  ) as { ok: number; bad: number }
  expect(ctx).toEqual({ ok: 42, bad: -1 })
  expect(logged).toEqual(['done', 'done'])
})

test(cases.returnInsideSwitch.name, () => {
  const out = run(cases.returnInsideSwitch.input, inlineFunctions)
  expect(out).not.toMatch(/function classify/)
  const ctx = new Function(`${out}\nreturn { a: a, b: b, c: c };`)() as {
    a: string
    b: string
    c: string
  }
  expect(ctx).toEqual({ a: 'zero', b: 'one', c: 'many' })
})

test(cases.returnInsideLabeledLoop.name, () => {
  const out = run(cases.returnInsideLabeledLoop.input, inlineFunctions)
  expect(out).not.toMatch(/function firstMatch/)
  expect(new Function('data', 'target', `${out}\nreturn idx;`)([1, 2, 3], 2)).toBe(1)
  expect(new Function('data', 'target', `${out}\nreturn idx;`)([1, 2, 3], 9)).toBe(-1)
})

function inlineTrace(src: string, argNames: string[], argValues: unknown[]): unknown[] {
  const logs: unknown[] = []
  const log = (...args: unknown[]): void => {
    logs.push(args.length <= 1 ? args[0] : args)
  }
  try {
    // oxlint-disable-next-line no-new-func
    const fn = new Function('log', ...argNames, src) as (
      log: (...args: unknown[]) => void,
      ...rest: unknown[]
    ) => void
    fn(log, ...argValues)
  } catch (error) {
    logs.push(`__throw__:${(error as Error).constructor.name}`)
  }
  return logs
}

// Compare logs and thrown classes before and after inlining, then return output
// for shape assertions.
function preservesInline(code: string, argNames: string[] = [], argValues: unknown[] = []): string {
  const out = run(code, inlineFunctions)
  expect(inlineTrace(out, argNames, argValues)).toEqual(inlineTrace(code, argNames, argValues))
  return out
}

test('inlineFunctions does not hoist a call out of a while-test header (F1)', () => {
  const out = preservesInline(
    `var n = 0;
function step() { n = n + 1; log(n); return n < 3; }
while (step()) { log("body"); }`,
  )
  expect(out).toContain('function step')
})

test('inlineFunctions does not hoist a call out of a for-test or for-update header (F1)', () => {
  preservesInline(
    `var i = 0;
function upd() { i = i + 1; log("u"); }
function keepGoing() { log("t"); return i < 2; }
for (; keepGoing(); upd()) { log(i); }`,
  )
})

test('inlineFunctions does not hoist a call out of a do-while test (F1)', () => {
  preservesInline(
    `var n = 0;
function tick() { n = n + 1; log(n); return n < 3; }
do { log("body"); } while (tick());`,
  )
})

test('inlineFunctions still inlines a for-init call, which runs once before the loop (F1)', () => {
  const out = preservesInline(
    `function start() { log("start"); return 0; }
for (var i = start(); i < 2; i++) { log(i); }`,
  )
  expect(out).not.toMatch(/function start/)
})

test('inlineFunctions does not hoist a switch case-test above the switch (F2)', () => {
  const out = preservesInline(
    `function key() { log("key"); return 1; }
var x = 2;
switch (x) {
  case key():
    log("one");
    break;
  default:
    log("def");
}`,
  )
  expect(out).toContain('function key')
})

test('inlineFunctions does not reorder past an earlier side effect in the same statement (F3)', () => {
  preservesInline(
    `function f() { log("f"); return 1; }
log(log("a"), f());`,
  )
})

test('inlineFunctions does not run a body ahead of a throwing sub-expression (F3)', () => {
  preservesInline(
    `function f() { log("f"); return 1; }
try { log(null.x + f()); } catch (e) { log(e.constructor.name); }`,
  )
})

test('inlineFunctions does not force a logical-assignment RHS to run (F4)', () => {
  preservesInline(
    `function f(t) { log(t); return 9; }
var a = 5; a ||= f("a");
var b = 0; b &&= f("b");
var c = 7; c ??= f("c");
log([a, b, c]);`,
  )
})

test('inlineFunctions does not reorder past an earlier element or property side effect (F3)', () => {
  preservesInline(
    `function f(t) { log("f"); return t; }
var arr = [log("l"), f(1)];
var o = { x: log("m"), y: f(2) };
log(arr, o);`,
  )
})

test('inlineFunctions does not run a body an optional chain would skip (F5)', () => {
  preservesInline(
    `function f(t) { log(t); return 1; }
var obj = null;
var foo = null;
var bar = null;
obj?.m(f("a"));
foo?.(f("b"));
var v = bar?.[f("c")];
log("done", v);`,
  )
})

test('inlineFunctions checks a write-only free variable for a binding conflict (F6)', () => {
  preservesInline(
    `function f() { k = 1; }
var k = 0;
function g() { var k = 5; f(); log(k); }
g();
log(k);`,
  )
})

test('inlineFunctions does not alias a param onto a free variable the body writes (F7)', () => {
  preservesInline(
    `function f(a, b) { k = 99; return a; }
var k = 1;
var v = f(k);
log(v, k);`,
  )
})

test('inlineFunctions does not collapse a var and a nested function of the same name (F9)', () => {
  const out = preservesInline(
    `function f() { var c = null; function c() { return 2; } return typeof c; }
{ log(f()); }`,
  )
  expect(out).toContain('function f')
})

test('inlineFunctions does not leak a nested function declaration into the caller (F10)', () => {
  const out = preservesInline(
    `function f() {
  function g() { return 1; }
  return g();
}
log(typeof g);
var b = f();
log(b);`,
  )
  expect(out).toContain('function f')
})

test('inlineFunctions does not inline a named function expression whose self-name would dangle (F11)', () => {
  preservesInline(
    `function f() { var g = function h(n) { return n <= 0 ? 0 : h(n - 1); }; return g(3); }
log(f());`,
  )
})

test('inlineFunctions does not splice a class declaration into the caller (F12)', () => {
  const out = preservesInline(
    `function f() {
  class C { m() { return 1; } }
  return new C().m();
}
var C = 5;
var v = f();
log(v, C);`,
  )
  expect(out).toContain('function f')
})

test('inlineFunctions does not lose a destructuring declarator to the caller scope (F13)', () => {
  const out = preservesInline(
    `function f(o) { var { a, ...rest } = o; return a; }
var a = 1;
var v = f({ a: 2, b: 3 });
log(v, a);`,
  )
  expect(out).toContain('function f')
})

test('inlineFunctions does not conflate a block-scoped let with an outer free reference (F14)', () => {
  const out = preservesInline(
    `var x = 100;
function f(p) {
  var r = 0;
  { let x = 1; r += x; }
  r += x;
  return r;
}
var v = f(0);
log(v);`,
  )
  expect(out).toContain('function f')
})

test('inlineFunctions gives a fall-through complex body the original undefined result (F8)', () => {
  preservesInline(
    `function f(c) { if (c) { return 1; } }
var x = "prev";
x = f(false);
log(x);`,
  )
})

test('inlineFunctions leaves an assignment target untouched when a complex body throws (F8)', () => {
  preservesInline(
    `function g() { log("g"); throw new Error("boom"); }
function f(c) { if (c) { return 1; } g(); return 2; }
var x = "prev";
try { x = f(false); } catch (e) { log(e.constructor.name); }
log(x);`,
  )
})

test('inlineFunctions keeps a temp for a let/const declarator rather than emitting an init-less binding (F15)', () => {
  const code = `function pick(x) { if (x) { return 1; } return 2; }
const a = pick(cond);
let b = pick(!cond);
log([a, b]);`
  for (const cond of [true, false]) {
    const out = preservesInline(code, ['cond'], [cond])
    expect(() => new Function('cond', out)).not.toThrow()
  }
})

test('inlineFunctions picks an inline label that avoids an enclosing user label (F16)', () => {
  const code = `function pick(x) { if (x) { return 1; } return 2; }
_inlined: {
  var v = pick(cond);
  log(v);
}`
  for (const cond of [true, false]) {
    preservesInline(code, ['cond'], [cond])
  }
})

test('inlineFunctions does not drop an unrelated same-named declaration (F17)', () => {
  const code = `var merge;
function helper() { return 42; }
function outer(x) {
  function merge(n) { return n + 1; }
  return cond ? merge(x) : merge(x + 1);
}
log(helper());
log(outer(5));`
  for (const cond of [true, false]) {
    const out = preservesInline(code, ['cond'], [cond])
    expect(out).toContain('function merge')
  }
})

test('inlineFunctions rechecks free variables a chained inline introduced (F18)', () => {
  preservesInline(
    `var g = 10;
function a() { return g; }
function b() { return a() + 1; }
function c() { var g = 999; return b(); }
log(c());`,
  )
})

test('inlineFunctions returns false when stale referencePaths point at already-inlined sites', () => {
  // A second call sees stale reference paths from the first invocation.
  const ast = parse(
    `function add(a, b) { return a + b; }
var x = add(1, 2);
var y = add(3, 4);`,
    { sourceType: 'unambiguous' },
  )
  inlineFunctions(ast)
  expect(inlineFunctions(ast)).toBe(false)
  expect(inlineFunctions(ast)).toBe(false)
})

test('inlineFunctions evaluates an elided identifier argument for an unused parameter (A01-01)', () => {
  const out = preservesInline(
    `function f(a) { return 7; }
try { var v = f(nope); log(v); } catch (e) { log(e.constructor.name); }`,
  )
  expect(out).not.toMatch(/function f\(/)
  // Dropping the argument temp would erase its ReferenceError.
  expect(out).toContain('nope')
})

test('inlineFunctions preserves TDZ evaluation of an elided argument (A01-01b)', () => {
  preservesInline(
    `function f(a) { return 7; }
try { var v = f(later); log(v); } catch (e) { log(e.constructor.name); }
let later = 1;`,
  )
})

test('inlineFunctions reads an aliased argument before the body mutates it (A01-06)', () => {
  const out = preservesInline(
    `var g = 1;
function bump(n) { if (n <= 0) { g = 99; return 0; } return bump(n - 1); }
function f(p) { bump(1); return p; }
var v = f(g);
log(v);`,
  )
  expect(out).not.toMatch(/function f\(/)
})

test('inlineFunctions does not let a catch parameter capture a same-named free variable (A01-02)', () => {
  const out = preservesInline(
    `var e = 'outer';
function f() {
  try { throw 1; } catch (e) { log('inner', e); }
  log('after', e);
}
f();`,
  )
  expect(out).not.toMatch(/function f\(/)
})

test('inlineFunctions does not inline a reassigned function declaration (A01-04)', () => {
  const out = preservesInline(
    `function f() { return 1; }
f = function () { return 2; };
log(f());`,
  )
  expect(out).toContain('f = function')
})

test('inlineFunctions does not inline a var-redeclared function declaration (A01-05)', () => {
  preservesInline(
    `function f() { return 1; }
var f = function () { return 2; };
log(f());`,
  )
})

test('inlineFunctions does not publish a declarator target a finally observes (A01-07)', () => {
  const out = preservesInline(
    `function peek(n) { if (n <= 0) { log('t', t); return 0; } return peek(n - 1); }
function f() { try { return 1; } finally { peek(1); } }
var t = f();
log(t);`,
  )
  expect(out).not.toMatch(/function f\(/)
})

test('inlineFunctions does not splice a body into a with block (A01-08)', () => {
  const out = preservesInline(
    `var v = 'outer';
function f() { return v; }
var o = { v: 'inner' };
with (o) { var r = f(); }
log(r);`,
  )
  expect(out).toContain('function f')
})

test('inlineFunctions does not splice a body into a scope with direct eval (A01-09)', () => {
  const out = preservesInline(
    `var v = 'outer';
function f() { return v; }
function g() { eval('var v = "inner";'); return f(); }
log(g());`,
  )
  expect(out).toContain('function f')
})

test('inlineFunctions does not splice across an Annex B block-function hoist (A01-09b)', () => {
  const out = preservesInline(
    `var v = 1;
function f() { return v; }
function g() { { function v() { return 'fn'; } log(typeof v); } return f(); }
log(typeof g());`,
  )
  expect(out).toContain('function f')
})

test('inlineFunctions does not inline a sloppy callee into a strict caller (A01-10d)', () => {
  const out = preservesInline(
    `function f() { return delete undeclaredThing; }
function g() { 'use strict'; log(arguments.length); return f(); }
log(g());`,
  )
  // Spliced delete of an unbound name is invalid in a strict caller.
  expect(() => new Function('log', out)).not.toThrow()
  expect(out).toContain('function f')
})

test('inlineFunctions does not inline a strict callee into a sloppy caller (A01-10)', () => {
  preservesInline(
    `function f() { 'use strict'; undeclaredSink = 1; return 1; }
try { var v = f(); log(v); } catch (e) { log(e.constructor.name); }`,
  )
})

test('inlineFunctions keeps a zero-reference block-level function and its Annex B var (A01-11)', () => {
  const out = preservesInline(
    `function id(x) { return x; }
var y = id(5);
var v = 1;
function g() { { function w() {} } return typeof w; }
log(y, g());`,
  )
  expect(out).not.toMatch(/function id\(/)
  expect(out).toContain('function w')
})

test('inlineFunctions lets a bare return reset the return slot (A01-12)', () => {
  const out = preservesInline(
    `function f() { try { return 1; } finally { return; } }
var r = f();
log(r);`,
  )
  expect(out).not.toMatch(/function f\(/)
})

test('inlineFunctions does not reuse a hoisted callee var across a caller loop (A04 note)', () => {
  const out = preservesInline(
    `function f() { var y; if (flag) { y = 1; } return y; }
var results = [];
var flag;
var r;
for (var i = 0; i < 3; i++) { flag = i === 0; r = f(); results.push(r); }
log(results);`,
  )
  expect(out).toContain('function f')
})
