import { expect, test } from 'vitest'

import { switchToIf } from '../../src/transforms/switch-to-if'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('switch-to-if', switchToIf, {
  specExample: {
    name: 'switchToIf rewrites the spec example into a labeled if-chain',
    input: `switch (x) {
  case 1: a(); break;
  case 2: b();
  case 3: c(); break;
  default: d();
}`,
  },

  noDefault: {
    name: 'switchToIf produces no _switchDefault var when the switch has no default',
    input: `switch (x) {
  case 1: a(); break;
  case 2: b(); break;
}`,
  },
  defaultInMiddle: {
    name: 'switchToIf preserves the default semantics when default is between cases',
    input: `switch (x) {
  case 1: a();
  default: d();
  case 2: b();
}`,
  },
  defaultAtStart: {
    name: 'switchToIf preserves the default semantics when default is the first clause',
    input: `switch (x) {
  default: d();
  case 1: a();
}`,
  },
  onlyDefault: {
    name: 'switchToIf handles a switch with only a default clause',
    input: `switch (x) {
  default: d();
}`,
  },
  emptySwitch: {
    name: 'switchToIf handles an empty switch (still evaluates the discriminant)',
    input: `switch (compute()) {}`,
  },

  consecutiveFallthrough: {
    name: 'switchToIf preserves fallthrough between consecutive non-breaking cases',
    input: `switch (x) {
  case 1:
  case 2:
  case 3: triple(); break;
  case 4: solo(); break;
}`,
  },
  emptyDefaultBeforeCase: {
    name: 'switchToIf preserves empty-default fallthrough into a following case',
    input: `switch (x) {
  default:
  case 1: handle();
}`,
  },

  breakInsideNestedLoopUntouched: {
    name: 'switchToIf does not rewrite an unlabeled break inside a nested loop in a case',
    input: `switch (x) {
  case 1:
    while (cond) {
      break;
    }
    break;
}`,
  },
  breakInsideNestedSwitchUntouched: {
    name: 'switchToIf does not rewrite an unlabeled break belonging to a nested switch',
    input: `switch (x) {
  case 1:
    switch (y) {
      case 2: break;
    }
    break;
}`,
  },
  breakAlreadyLabeledUntouched: {
    name: 'switchToIf does not rewrite an already-labeled break',
    input: `outer: while (cond) {
  switch (x) {
    case 1: break outer;
  }
}`,
  },
  breakInsideArrowBodyUntouched: {
    name: 'switchToIf does not descend into a callback function inside a case',
    input: `switch (x) {
  case 1:
    arr.forEach(function (e) {
      switch (e) {
        case 2: break;
      }
    });
    break;
}`,
  },

  returnInsideCase: {
    name: 'switchToIf preserves a return inside a case',
    input: `function f(x) {
  switch (x) {
    case 1: return "one";
    case 2: return "two";
  }
}`,
  },
  throwInsideCase: {
    name: 'switchToIf preserves a throw inside a case',
    input: `function f(x) {
  switch (x) {
    case 1: throw new Error("nope");
    case 2: return "ok";
  }
}`,
  },

  sideEffectfulDiscriminant: {
    name: 'switchToIf evaluates a side-effectful discriminant exactly once',
    input: `switch (compute()) {
  case 1: a(); break;
  case 2: b(); break;
}`,
  },

  expressionCaseTest: {
    name: 'switchToIf handles a member-expression case test',
    input: `switch (x) {
  case STATE.READY: a(); break;
  case STATE.DONE: b(); break;
}`,
  },
  stringCaseTest: {
    name: 'switchToIf handles string-literal case tests',
    input: `switch (s) {
  case "one": a(); break;
  case "two": b(); break;
  default: d();
}`,
  },

  functionDeclInCase: {
    name: 'switchToIf leaves a switch with a function declaration in a case untouched',
    input: `function go(x) {
  switch (x) {
    case 1:
      function helper(n) { return n * 10; }
      return helper(x);
    case 2:
      return helper(x);
  }
  return -1;
}`,
  },
})

test(cases.specExample.name, () => {
  const out = run(cases.specExample.input, switchToIf)
  expect(out).toMatch(/_switch:\s*\{/)
  expect(out).toMatch(/var _switchValue = x/)
  expect(out).toMatch(/var _switchFall = false/)
  // A final default runs after fallthrough or no match without another test.
  expect(out).not.toMatch(/_switchDefault/)
  expect(out).toMatch(/break _switch/)
  expect(out).not.toContain('switch (x)')
  // Each case test must appear once.
  expect(out.match(/_switchValue === 1/g)?.length).toBe(1)

  const harness = (val: number): string => `
var x = ${val};
function a() { out.push("a"); }
function b() { out.push("b"); }
function c() { out.push("c"); }
function d() { out.push("d"); }
${out}
`
  const runOnce = (val: number): unknown[] => {
    const arr: unknown[] = []
    new Function('out', harness(val))(arr)
    return arr
  }
  expect(runOnce(1)).toEqual(['a'])
  expect(runOnce(2)).toEqual(['b', 'c'])
  expect(runOnce(3)).toEqual(['c'])
  expect(runOnce(9)).toEqual(['d'])
})

test(cases.noDefault.name, () => {
  const out = run(cases.noDefault.input, switchToIf)
  expect(out).not.toMatch(/_switchDefault/)
})

test(cases.defaultInMiddle.name, () => {
  const harness = (val: number) => `
var x = ${val};
function a() { out.push("a"); }
function b() { out.push("b"); }
function d() { out.push("d"); }
${run(cases.defaultInMiddle.input, switchToIf)}
`
  const runOnce = (val: number): unknown[] => {
    const arr: unknown[] = []
    new Function('out', harness(val))(arr)
    return arr
  }
  expect(runOnce(1)).toEqual(['a', 'd', 'b'])
  expect(runOnce(2)).toEqual(['b'])
  expect(runOnce(3)).toEqual(['d', 'b'])
})

test(cases.defaultAtStart.name, () => {
  const harness = (val: number) => `
var x = ${val};
function a() { out.push("a"); }
function d() { out.push("d"); }
${run(cases.defaultAtStart.input, switchToIf)}
`
  const runOnce = (val: number): unknown[] => {
    const arr: unknown[] = []
    new Function('out', harness(val))(arr)
    return arr
  }
  expect(runOnce(1)).toEqual(['a'])
  expect(runOnce(2)).toEqual(['d', 'a'])
})

test(cases.onlyDefault.name, () => {
  const out = run(cases.onlyDefault.input, switchToIf)
  const harness = `
var x = 7;
function d() { out.push("d"); }
${out}
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['d'])
})

test(cases.emptySwitch.name, () => {
  const out = run(cases.emptySwitch.input, switchToIf)
  const harness = `
var calls = 0;
function compute() { calls++; return 1; }
${out}
out.push(calls);
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual([1])
})

test(cases.consecutiveFallthrough.name, () => {
  const harness = (val: number) => `
var x = ${val};
function triple() { out.push("triple"); }
function solo() { out.push("solo"); }
${run(cases.consecutiveFallthrough.input, switchToIf)}
`
  const runOnce = (val: number): unknown[] => {
    const arr: unknown[] = []
    new Function('out', harness(val))(arr)
    return arr
  }
  expect(runOnce(1)).toEqual(['triple'])
  expect(runOnce(2)).toEqual(['triple'])
  expect(runOnce(3)).toEqual(['triple'])
  expect(runOnce(4)).toEqual(['solo'])
  expect(runOnce(5)).toEqual([])
})

test(cases.emptyDefaultBeforeCase.name, () => {
  const harness = (val: number) => `
var x = ${val};
function handle() { out.push("handle"); }
${run(cases.emptyDefaultBeforeCase.input, switchToIf)}
`
  const runOnce = (val: number): unknown[] => {
    const arr: unknown[] = []
    new Function('out', harness(val))(arr)
    return arr
  }
  expect(runOnce(1)).toEqual(['handle'])
  expect(runOnce(2)).toEqual(['handle'])
})

test(cases.breakInsideNestedLoopUntouched.name, () => {
  const out = run(cases.breakInsideNestedLoopUntouched.input, switchToIf)
  expect(out).toMatch(/while \(cond\)\s*\{\s*break;\s*\}/)
  const harness = `
var x = 1;
var cond = true;
${out}
out.push('after');
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['after'])
})

test(cases.breakInsideNestedSwitchUntouched.name, () => {
  const out = run(cases.breakInsideNestedSwitchUntouched.input, switchToIf)
  const runOnce = (x: number, y: number): unknown[] => {
    const arr: unknown[] = []
    new Function('out', `var x = ${x}; var y = ${y}; ${out}; out.push('after');`)(arr)
    return arr
  }
  expect(runOnce(1, 2)).toEqual(['after'])
  expect(runOnce(1, 3)).toEqual(['after'])
  expect(runOnce(2, 2)).toEqual(['after'])
})

test(cases.breakAlreadyLabeledUntouched.name, () => {
  const out = run(cases.breakAlreadyLabeledUntouched.input, switchToIf)
  expect(out).toContain('break outer')
})

test(cases.breakInsideArrowBodyUntouched.name, () => {
  const out = run(cases.breakInsideArrowBodyUntouched.input, switchToIf)
  const harness = `
var x = 1;
var arr = [1, 2, 3];
${out}
out.push('after');
`
  const result: unknown[] = []
  new Function('out', harness)(result)
  expect(result).toEqual(['after'])
})

test(cases.returnInsideCase.name, () => {
  const out = run(cases.returnInsideCase.input, switchToIf)
  const harness = `
${out}
out.push(f(1));
out.push(f(2));
out.push(f(3));
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['one', 'two', undefined])
})

test(cases.throwInsideCase.name, () => {
  const out = run(cases.throwInsideCase.input, switchToIf)
  const harness = `
${out}
try { f(1); } catch (e) { out.push("threw:" + e.message); }
out.push(f(2));
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['threw:nope', 'ok'])
})

test(cases.sideEffectfulDiscriminant.name, () => {
  const out = run(cases.sideEffectfulDiscriminant.input, switchToIf)
  const harness = `
var calls = 0;
function compute() { calls++; return 1; }
function a() { out.push("a"); }
function b() { out.push("b"); }
${out}
out.push("calls=" + calls);
`
  const arr: unknown[] = []
  new Function('out', harness)(arr)
  expect(arr).toEqual(['a', 'calls=1'])
})

test(cases.expressionCaseTest.name, () => {
  const out = run(cases.expressionCaseTest.input, switchToIf)
  expect(out).toContain('STATE.READY')
  expect(out).toContain('STATE.DONE')
})

test(cases.stringCaseTest.name, () => {
  const out = run(cases.stringCaseTest.input, switchToIf)
  expect(out).toContain('"one"')
  expect(out).toContain('"two"')
})

test(cases.functionDeclInCase.name, () => {
  const out = run(cases.functionDeclInCase.input, switchToIf)
  const fn = new Function(`${out}\nreturn go;`)() as (x: number) => number
  expect(fn(1)).toBe(10)
  expect(fn(2)).toBe(20)
  expect(fn(3)).toBe(-1)
})

test('switchToIf emits an if/else chain when no case falls through', () => {
  const input = `switch (x) {
  case 1: a(); break;
  case 2: b(); break;
  default: d();
}`
  const out = run(input, switchToIf)
  expect(out).not.toMatch(/_switchFall|_switchDefault|_switch:/)
  expect(out).toMatch(/var _switchValue = x/)
  expect(out).toMatch(/if \(_switchValue === 1\)/)
  expect(out).toMatch(/else if \(_switchValue === 2\)/)
  expect(out).toMatch(/else \{[\s\S]*d\(\)/)
})

test('switchToIf caches a non-pure discriminant in the if/else chain', () => {
  const input = `switch (compute()) {
  case 1: a(); break;
  case 2: b(); break;
}`
  const out = run(input, switchToIf)
  expect(out).toMatch(/var _switchValue = compute\(\)/)
  expect(out).toMatch(/if \(_switchValue === 1\)/)
  expect(out).not.toMatch(/_switchFall|_switchDefault/)
})

test('switchToIf caches an identifier discriminant so a case test cannot re-read it', () => {
  const input = `var x = 1; switch (x) { case 1: a(); break; case 2: b(); break; }`
  const out = run(input, switchToIf)
  expect(out).toMatch(/var _switchValue = x/)
  expect(out).toMatch(/if \(_switchValue === 1\)/)
})

test('switchToIf still inlines a literal discriminant without a temp', () => {
  const out = run('switch (2) { case 1: a(); break; case 2: b(); break; }', switchToIf)
  expect(out).not.toMatch(/_switchValue/)
  expect(out).toMatch(/if \(2 === 1\)/)
})

test('switchToIf falls back to labeled form when fallthrough is present', () => {
  const input = `switch (x) {
  case 1: a();
  case 2: b(); break;
}`
  const out = run(input, switchToIf)
  expect(out).toMatch(/_switch:/)
  expect(out).toMatch(/_switchFall/)
})

test('switchToIf falls back to labeled form when a mid-case break is unlabeled', () => {
  const input = `switch (x) {
  case 1: if (early) break; a(); break;
  case 2: b(); break;
}`
  const out = run(input, switchToIf)
  expect(out).toMatch(/break _switch/)
})

test('switchToIf preserves an unlabeled break inside a nested loop under the fast path', () => {
  const input = `switch (x) {
  case 1: while (true) break; finalize(); break;
}`
  const out = run(input, switchToIf)
  expect(out).not.toMatch(/_switchFall/)
  expect(out).toMatch(/while \(true\) break;/)
  expect(out).not.toMatch(/break _switch/)
})

test('switchToIf preserves runtime behavior on a no-fallthrough switch', () => {
  const input = `switch (x) {
  case 1: out.push("a"); break;
  case 2: out.push("b"); break;
  default: out.push("d");
}`
  const out = run(input, switchToIf)
  const runOnce = (x: unknown): unknown[] => {
    const arr: unknown[] = []
    new Function('out', 'x', out)(arr, x)
    return arr
  }
  expect(runOnce(1)).toEqual(['a'])
  expect(runOnce(2)).toEqual(['b'])
  expect(runOnce(99)).toEqual(['d'])
})

function expectSwitchPreserves(src: string): void {
  expect(trace(run(src, switchToIf))).toEqual(trace(src))
}

test('switchToIf keeps an enclosing label targetable (F1)', () => {
  const src =
    'lbl: switch (compute()) { case 1: log("one"); break lbl; } function compute() { return 1; }'
  expect(() => new Function('log', run(src, switchToIf))).not.toThrow()
  expectSwitchPreserves(src)
})

test('switchToIf does not drop an empty switch discriminant (F4)', () => {
  expectSwitchPreserves(
    'try { switch (nopeNotDeclared) {} log("no-throw"); } catch (e) { log("caught:" + (e instanceof ReferenceError)); }',
  )
  expectSwitchPreserves(
    'var n = 0; var o = { valueOf: function () { n++; return 1; } }; switch (o + 0) {} log(n);',
  )
})

test('switchToIf does not re-evaluate a case test for the default (F5)', () => {
  expectSwitchPreserves(
    'function f(n) { log("t" + n); return n; } switch (3) { case f(1): log("a"); case f(2): log("b"); break; default: log("d"); }',
  )
})

test('switchToIf preserves cross-case block scope and TDZ (F6, F7)', () => {
  expectSwitchPreserves(
    'switch (1) { case 1: class C { m() { return 7; } } case 2: log(new C().m()); break; }',
  )
  expectSwitchPreserves(
    'var y = "outer"; try { switch (1) { case 1: log(y); break; case 2: let y = 2; log(y); break; } } catch (e) { log("caught:" + (e instanceof ReferenceError)); }',
  )
})

test('switchToIf does not hoist a case function declaration past an outer binding (F8)', () => {
  expectSwitchPreserves(
    'function g() { return "outer"; } switch (2) { case 1: function g() { return "inner"; } case 2: log(g()); break; } log(g());',
  )
})

// A08-01: A coercing case test can change value between reads.
test('switchToIf reads a coercing case test exactly once (A08-01)', () => {
  const src =
    'var n = 0; var probe = { valueOf: function () { return ++n; } }; switch (2) { case +probe: log("a"); case 9: log("b"); default: log("d"); } log("n=" + n);'
  const out = run(src, switchToIf)
  expect(out).toMatch(/_switch:/)
  expect(out).not.toContain('switch (2)')
  expect(out).not.toMatch(/_switchDefault/)
  expectSwitchPreserves(src)
})

test('switchToIf reads a coercing case test exactly once across coercion kinds (A08-01)', () => {
  expectSwitchPreserves(
    'var probe = { toString: function () { log("toString"); return "x"; } }; switch ("q") { case probe + "": log("a"); case "q": log("b"); default: log("d"); }',
  )
  expectSwitchPreserves(
    'var probe = { valueOf: function () { log("valueOf"); return 1; } }; switch (true) { case probe < 2: log("a"); case "x": log("b"); default: log("d"); }',
  )
  expectSwitchPreserves(
    'var probe = { toString: function () { log("toString"); return "z"; } }; switch ("q") { case `${probe}`: log("a"); case "nope": log("b"); default: log("d"); }',
  )
})

// A08-02: An accessor-backed case test must be read once.
test('switchToIf reads an accessor-backed identifier case test exactly once (A08-02)', () => {
  const src =
    'Object.defineProperty(globalThis, "__a08g", { configurable: true, get: function () { log("getter"); return 5; } }); switch (2) { case __a08g: log("a"); case 9: log("b"); default: log("d"); } delete globalThis.__a08g;'
  expectSwitchPreserves(src)
})

// A08-03: The generated outer label must avoid enclosing and nested user labels.
test('switchToIf does not collide its label with a user _switch label (A08-03)', () => {
  const enclosing =
    '_switch: for (var i = 0; i < 3; i++) { switch (i) { case 0: log("a"); case 1: log("b"); break; default: break _switch; } }'
  expect(() => new Function('log', run(enclosing, switchToIf))).not.toThrow()
  expectSwitchPreserves(enclosing)

  const nested =
    'switch (1) { case 1: { _switch: { log("inner"); break _switch; } } log("a"); default: log("d"); }'
  expect(() => new Function('log', run(nested, switchToIf))).not.toThrow()
  expectSwitchPreserves(nested)

  const bothTaken =
    '_switch: _switch2: for (var i = 0; i < 2; i++) { switch (i) { case 0: log("a"); case 1: log("b"); break; default: break _switch; } }'
  expect(() => new Function('log', run(bothTaken, switchToIf))).not.toThrow()
  expectSwitchPreserves(bothTaken)
})

// A08-04: A labeled sloppy function hoists across the switch block.
test('switchToIf leaves a switch with a labelled function declaration intact (A08-04)', () => {
  const src =
    'function f(x) { switch (x) { case 1: L: function g() { return "inner"; } case 2: log(typeof g); } } f(2);'
  expect(run(src, switchToIf)).toContain('switch (x)')
  expectSwitchPreserves(src)

  expectSwitchPreserves(
    'function f(x) { var g = "outer"; switch (x) { case 1: L: function g() { return "inner"; } case 2: log(typeof g); } } f(2);',
  )
  expectSwitchPreserves(
    'function f(x) { switch (x) { case 1: A: B: function g() { return "inner"; } case 2: log(typeof g); } } f(2);',
  )
})
