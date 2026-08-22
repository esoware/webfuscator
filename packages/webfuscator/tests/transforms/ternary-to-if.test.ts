import { expect, test } from 'vitest'

import { ternaryToIf } from '../../src/transforms/ternary-to-if'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('ternary-to-if', ternaryToIf, {
  expressionStatement: {
    name: 'ternaryToIf rewrites a ternary as an expression statement into if/else with statement bodies',
    input: `a ? b() : c();`,
  },
  returnStatement: {
    name: 'ternaryToIf rewrites a return-position ternary into if/else with returns',
    input: `function f() {
  return a ? b : c;
}`,
  },
  throwStatement: {
    name: 'ternaryToIf rewrites a throw-position ternary into if/else with throws',
    input: `function f() {
  throw a ? new Error("x") : new Error("y");
}`,
  },

  callArgument: {
    name: 'ternaryToIf hoists a temp when the ternary is a call argument',
    // Declare `log` so its read cannot be an unresolved accessor.
    input: `function log(_v) {}
log(a ? b : c);`,
  },
  variableInit: {
    name: 'ternaryToIf lifts a single bare-ident var initializer into the if branches',
    input: `var x = a ? b : c;`,
  },
  ifTest: {
    name: 'ternaryToIf hoists a temp when the ternary is an if test',
    input: `if (a ? b : c) {
  log(1);
}`,
  },
  binaryRight: {
    name: 'ternaryToIf hoists a temp when the ternary is a binary expression operand',
    input: `var x = 1 + (a ? b : c);`,
  },

  bareAssignmentStatement: {
    name: 'ternaryToIf lifts a bare-ident `=` assignment statement into the if branches',
    input: `y = a ? b : c;`,
  },
  memberAssignmentStatement: {
    name: 'ternaryToIf hoists a temp for a member-LHS assignment statement',
    // Declare `obj` so the write-target base is a proved-safe read.
    input: `var obj = {};
obj.x = a ? b : c;`,
  },
  compoundAssignmentStatement: {
    name: 'ternaryToIf hoists a temp for a compound assignment statement',
    // Declare `y` so the compound target read is proved safe.
    input: `var y = 0;
y += a ? b : c;`,
  },
  varInForInit: {
    name: 'ternaryToIf hoists a temp for a var initializer inside a for-init slot',
    input: `for (var x = a ? b : c; x < 10; x++) { log(x); }`,
  },
  multiDeclarator: {
    name: 'ternaryToIf hoists a temp for a multi-declarator var',
    input: `var x = a ? b : c, y = 0;`,
  },

  insideDefaultParam: {
    name: 'ternaryToIf leaves a ternary inside a default parameter alone',
    input: `function f(x = a ? b : c) {
  return x;
}`,
  },
  insideWhileTest: {
    name: 'ternaryToIf leaves a ternary in a while test alone',
    input: `while (a ? b : c) {
  step();
}`,
  },

  nestedTernaryDoesNotDuplicateBranches: {
    name: 'ternaryToIf does not duplicate inner-ternary branches via orphaned-subtree traversal',
    input: `i ? (cond ? side() : other()) : i;`,
  },

  sequenceConsequentExpandsInOrder: {
    name: 'ternaryToIf expands a SequenceExpression consequent so inner-ternary lifts insert after preceding statements',
    input: `c ? (y = src(), z ? f(y) : g(y)) : nope;`,
  },

  sequenceReturnExpands: {
    name: 'ternaryToIf expands a SequenceExpression in return position into preceding statements + return final',
    input: `function f() {
  return cond ? (sideA(), sideB(), result) : alt;
}`,
  },

  ifTestSequenceWithDependency: {
    name: 'ternaryToIf hoists an if-test SequenceExpression so the ternary sees earlier assignments',
    input: `if (m = src(), pick ? (t = m + 10) : (t = m * 10), t > 0) {
  out.push("yes:" + t);
}`,
  },

  ternaryInsideOuterConsequentSequence: {
    name: 'ternaryToIf keeps an inner-ternary inside its outer ternary consequent gate when the inner sits in a SequenceExpression branch',
    input: `outer ? (log("a"), inner ? log("b") : log("c"), log("d")) : log("e");`,
  },

  ternaryInsideLogicalRightWithoutLogicalToTernary: {
    name: 'ternaryToIf lowers an enclosing && right operand itself so the inner ternary lands at a safe statement position',
    input: `gate && (pick ? a() : b());`,
  },
})

test(cases.expressionStatement.name, () => {
  const out = run(cases.expressionStatement.input, ternaryToIf)
  expect(out).toMatch(/if \(a\)\s*\{\s*b\(\);\s*\}\s*else\s*\{\s*c\(\);\s*\}/)
  expect(out).not.toContain('?')
})

test(cases.returnStatement.name, () => {
  const out = run(cases.returnStatement.input, ternaryToIf)
  expect(out).toMatch(/if \(a\)\s*\{\s*return b;\s*\}\s*else\s*\{\s*return c;\s*\}/)
})

test(cases.throwStatement.name, () => {
  const out = run(cases.throwStatement.input, ternaryToIf)
  expect(out).toMatch(
    /if \(a\)\s*\{\s*throw new Error\("x"\);\s*\}\s*else\s*\{\s*throw new Error\("y"\);\s*\}/,
  )
})

test(cases.callArgument.name, () => {
  const out = run(cases.callArgument.input, ternaryToIf)
  expect(out).toMatch(/var _ternaryResult/)
  expect(out).toMatch(
    /if \(a\)\s*\{\s*_ternaryResult\d* = b;\s*\}\s*else\s*\{\s*_ternaryResult\d* = c;\s*\}/,
  )
  expect(out).toMatch(/log\(_ternaryResult\d*\)/)
  expect(out).not.toContain('? b : c')
})

test(cases.variableInit.name, () => {
  const out = run(cases.variableInit.input, ternaryToIf)
  expect(out).not.toMatch(/_ternaryResult/)
  expect(out).toMatch(/var x;\s*if \(a\)\s*\{\s*x = b;\s*\}\s*else\s*\{\s*x = c;\s*\}/)
})

test(cases.ifTest.name, () => {
  const out = run(cases.ifTest.input, ternaryToIf)
  expect(out).toMatch(/var _ternaryResult/)
  expect(out).toMatch(/if \(_ternaryResult\d*\)/)
})

test(cases.binaryRight.name, () => {
  const out = run(cases.binaryRight.input, ternaryToIf)
  expect(out).toMatch(/var x = 1 \+ _ternaryResult/)
})

test(cases.insideDefaultParam.name, () => {
  const out = run(cases.insideDefaultParam.input, ternaryToIf)
  expect(out).toContain('a ? b : c')
})

test(cases.insideWhileTest.name, () => {
  const out = run(cases.insideWhileTest.input, ternaryToIf)
  expect(out).toContain('a ? b : c')
})

test('ternaryToIf preserves runtime behavior of a return-position ternary', () => {
  const out = run(`function pick(x) { return x > 0 ? "pos" : "neg"; }`, ternaryToIf)
  const harness = `
${out}
out.push(pick(1), pick(-1));
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['pos', 'neg'])
})

test('ternaryToIf preserves runtime behavior of a hoist-position ternary', () => {
  const out = run(`var x = (1 < 2) ? "lt" : "gt";`, ternaryToIf)
  const harness = `
${out}
out.push(x);
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['lt'])
})

test(cases.bareAssignmentStatement.name, () => {
  const out = run(cases.bareAssignmentStatement.input, ternaryToIf)
  expect(out).not.toMatch(/_ternaryResult/)
  expect(out).toMatch(/if \(a\)\s*\{\s*y = b;\s*\}\s*else\s*\{\s*y = c;\s*\}/)
})

test(cases.memberAssignmentStatement.name, () => {
  const out = run(cases.memberAssignmentStatement.input, ternaryToIf)
  expect(out).toMatch(/_ternaryResult/)
})

test(cases.compoundAssignmentStatement.name, () => {
  const out = run(cases.compoundAssignmentStatement.input, ternaryToIf)
  expect(out).toMatch(/_ternaryResult/)
})

test(cases.varInForInit.name, () => {
  const out = run(cases.varInForInit.input, ternaryToIf)
  expect(out).toMatch(/_ternaryResult/)
})

test(cases.multiDeclarator.name, () => {
  const out = run(cases.multiDeclarator.input, ternaryToIf)
  expect(out).toMatch(/_ternaryResult/)
})

test('ternaryToIf preserves behavior across the bare-ident assignment specialization', () => {
  const out = run(
    `var y;
function side(v) { calls++; return v; }
var calls = 0, a = true;
y = a ? side(1) : side(2);`,
    ternaryToIf,
  )
  const harness = `
${out}
out.push(y, calls);
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual([1, 1])
})

test('ternaryToIf preserves behavior across the bare-ident var-init specialization with a sequence', () => {
  const out = run(
    `var calls = 0;
function sideA() { calls++; }
function sideB() { calls++; }
var cond = true;
var z = cond ? (sideA(), sideB(), "yes") : "no";`,
    ternaryToIf,
  )
  const harness = `
${out}
out.push(z, calls);
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['yes', 2])
})

test(cases.nestedTernaryDoesNotDuplicateBranches.name, () => {
  const out = run(cases.nestedTernaryDoesNotDuplicateBranches.input, ternaryToIf)
  const harness = `
var calls = 0;
function side() { calls++; return 1; }
function other() { calls++; return 2; }
var i = true, cond = true;
${out}
out.push(calls);
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual([1])
})

test(cases.sequenceConsequentExpandsInOrder.name, () => {
  const out = run(cases.sequenceConsequentExpandsInOrder.input, ternaryToIf)
  const harness = `
var y;
function src() { return 7; }
function f(v) { out.push("f:" + v); }
function g(v) { out.push("g:" + v); }
var c = true, z = true, nope = 0;
${out}
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['f:7'])
})

test(cases.sequenceReturnExpands.name, () => {
  const out = run(cases.sequenceReturnExpands.input, ternaryToIf)
  const harness = `
var calls = [];
function sideA() { calls.push("a"); }
function sideB() { calls.push("b"); }
${out}
out.push(f.call(null), calls.join(","));
`
  const arr: unknown[] = []
  new Function('cond', 'result', 'alt', 'out', harness)(true, 'r', 'fallback', arr)
  expect(arr).toEqual(['r', 'a,b'])
})

test(cases.ifTestSequenceWithDependency.name, () => {
  const out = run(cases.ifTestSequenceWithDependency.input, ternaryToIf)
  expect(out).not.toContain('?')
  const harness = `
var m, t;
function src() { return 4; }
${out}
`
  const runWith = (pick: boolean): unknown[] => {
    const arr: unknown[] = []
    new Function('pick', 'out', harness)(pick, arr)
    return arr
  }
  expect(runWith(true)).toEqual(['yes:14'])
  expect(runWith(false)).toEqual(['yes:40'])
})

test(cases.ternaryInsideOuterConsequentSequence.name, () => {
  const out = run(cases.ternaryInsideOuterConsequentSequence.input, ternaryToIf)
  expect(out).not.toContain('?')
  const harness = `
function log(v) { out.push(v); }
${out}
`
  const runWith = (outer: boolean, inner: boolean): unknown[] => {
    const arr: unknown[] = []
    new Function('outer', 'inner', 'out', harness)(outer, inner, arr)
    return arr
  }
  expect(runWith(true, true)).toEqual(['a', 'b', 'd'])
  expect(runWith(true, false)).toEqual(['a', 'c', 'd'])
  expect(runWith(false, true)).toEqual(['e'])
  expect(runWith(false, false)).toEqual(['e'])
})

test(cases.ternaryInsideLogicalRightWithoutLogicalToTernary.name, () => {
  const out = run(cases.ternaryInsideLogicalRightWithoutLogicalToTernary.input, ternaryToIf)
  expect(out).not.toContain('?')
  const harness = `
var calls = [];
function a() { calls.push("a"); return "av"; }
function b() { calls.push("b"); return "bv"; }
${out}
out.push(calls.join(","));
`
  const runWith = (gate: unknown, pick: boolean): unknown[] => {
    const arr: unknown[] = []
    new Function('gate', 'pick', 'out', harness)(gate, pick, arr)
    return arr
  }
  expect(runWith(true, true)).toEqual(['a'])
  expect(runWith(true, false)).toEqual(['b'])
  expect(runWith(false, true)).toEqual([''])
  expect(runWith(0, false)).toEqual([''])
})

function ternaryPreserves(code: string): void {
  expect(trace(run(code, ternaryToIf))).toEqual(trace(code))
}

test('ternaryToIf handles a const ternary init (F1)', () => {
  const out = run("const v = 1 ? 'y' : 'n'; log(v);", ternaryToIf)
  expect(() => new Function('log', out)).not.toThrow()
  ternaryPreserves("const v = 1 ? 'y' : 'n'; log(v);")
})

test('ternaryToIf does not crash on a detached path (F2)', () => {
  expect(() => run('let y = 1; log(((1 ? 1 : 2), (y || (1 ? 3 : 4))));', ternaryToIf)).not.toThrow()
  ternaryPreserves('let y = 1; log(((1 ? 1 : 2), (y || (1 ? 3 : 4))));')
})

test('ternaryToIf does not hoist past a preceding side effect (F3)', () => {
  ternaryPreserves("function s(t){log(t);return t} log(s('a') + (s('b') ? 1 : 2));")
})

test('ternaryToIf does not hoist a ternary out of a for header (F4)', () => {
  ternaryPreserves(
    "function s(t){log(t);return t} let i=0; for(; i < (s('T') ? 2 : 0); i++){} log(i);",
  )
})

test('ternaryToIf does not hoist a short-circuited ternary (F5)', () => {
  ternaryPreserves("function s(t){log(t);return t} log(s(0) && (s(1) && (s('r') ? 'x' : 'y')));")
})

test('ternaryToIf does not duplicate a hoisted sequence element (A07-01)', () => {
  ternaryPreserves(
    `function s(v) { log(v); return v; }
if (((true ? s('A') : 0), ((((true ? s('B') : 0), 1)) ? 'X' : 'Y'))) { log('T'); } else { log('F'); }`,
  )
})

test('ternaryToIf does not hoist a sequence past an earlier side effect (A07-02)', () => {
  ternaryPreserves(
    `function k(v) { log(v); return v; }
function f(a, b) { log('f', a, b); }
f(k('k'), (k('g'), true ? 1 : 2));`,
  )
})

test('ternaryToIf does not hoist a while-test sequence out of the loop (A07-03)', () => {
  ternaryPreserves(
    `var i = 0;
var n = 0;
while ((i = i + 1, i < 3 ? true : false)) { n = n + 1; if (n > 10) { break; } log(i); }
log('done', i, n);`,
  )
})

test('ternaryToIf does not hoist a for-update sequence out of the loop (A07-03b)', () => {
  ternaryPreserves(
    `var i = 0;
for (; i < 3; (log('u'), i = i + (true ? 1 : 1))) { log(i); }`,
  )
})

test('ternaryToIf does not hoist a parameter-default sequence out of the function (A07-04)', () => {
  ternaryPreserves(
    `var n = 0;
function f(a = (n = n + 1, true ? n : 0)) { log('f', a, n); }
f();
f();
log('n', n);`,
  )
})

test('ternaryToIf does not hoist an unreached switch-case test (A07-05)', () => {
  ternaryPreserves(
    `switch (1) {
  case 1: log('one'); break;
  case (log('t'), true ? 2 : 3): log('two'); break;
}`,
  )
})

test('ternaryToIf preserves the let TDZ of a declarator initializer (A07-06)', () => {
  ternaryPreserves(
    `function probe() { try { log(typeof x); } catch (e) { log('TDZ'); } return 1; }
let x = true ? probe() : 0;
log(x);`,
  )
})
