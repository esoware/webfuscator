import { expect, test } from 'vitest'

import { forToWhile } from 'src/transforms/for-to-while'

import { defineCases, run } from '../helpers'

const cases = defineCases('for-to-while', forToWhile, {
  specExample: {
    name: 'forToWhile rewrites the spec example into a hoisted-init while with a labeled iteration block',
    input: `for (var i = 0; i < 3; i++) {
  if (skip(i)) {
    continue;
  }
  log(i);
}`,
  },

  noInit: {
    name: 'forToWhile handles a for with no initializer',
    input: `for (; i < 3; i++) {
  log(i);
}`,
  },
  noTest: {
    name: 'forToWhile handles a for with no test (becomes while(true))',
    input: `for (var i = 0;; i++) {
  if (i >= 3) break;
  log(i);
}`,
  },
  noUpdate: {
    name: 'forToWhile handles a for with no update (no expression statement after the labeled block)',
    input: `for (var i = 0; i < 3;) {
  log(i);
  i++;
}`,
  },
  emptyHeader: {
    name: 'forToWhile rewrites a header-less for as while(true)',
    input: `for (;;) {
  break;
}`,
  },
  expressionInit: {
    name: 'forToWhile hoists an expression initializer as an expression statement',
    input: `for (i = 0; i < 3; i++) {
  log(i);
}`,
  },
  multiDeclaratorInit: {
    name: 'forToWhile hoists a multi-declarator initializer intact',
    input: `for (var i = 0, j = 10; i < 3; i++, j--) {
  log(i, j);
}`,
  },

  unlabeledContinueRewritten: {
    name: 'forToWhile rewrites an unlabeled continue inside the body to break <innerLabel>',
    input: `for (var i = 0; i < 3; i++) {
  if (i === 1) {
    continue;
  }
  log(i);
}`,
  },
  unlabeledContinueInsideNestedLoopUntouched: {
    name: 'forToWhile leaves an unlabeled continue inside a nested while alone',
    input: `for (var i = 0; i < 3; i++) {
  while (cond()) {
    continue;
  }
}`,
  },
  labeledContinueOnOurFor: {
    name: 'forToWhile rewrites continue <ourLabel> to break <innerLabel>',
    input: `outerLoop: for (var i = 0; i < 3; i++) {
  if (cond) {
    continue outerLoop;
  }
}`,
  },
  labeledContinueFromInsideNestedLoop: {
    name: 'forToWhile rewrites continue <ourLabel> from inside a nested loop too',
    input: `outerLoop: for (var i = 0; i < 3; i++) {
  for (var j = 0; j < 3; j++) {
    continue outerLoop;
  }
}`,
  },
  labeledContinueOtherLabel: {
    name: 'forToWhile leaves a labeled continue alone when the label is not ours',
    input: `someOther: while (cond()) {
  for (var i = 0; i < 3; i++) {
    continue someOther;
  }
}`,
  },

  unlabeledBreakUntouched: {
    name: 'forToWhile leaves an unlabeled break inside the body alone (still exits the while)',
    input: `for (var i = 0; i < 3; i++) {
  if (i === 2) break;
  log(i);
}`,
  },
  labeledBreakUntouched: {
    name: 'forToWhile leaves a labeled break inside the body alone',
    input: `outerLoop: for (var i = 0; i < 3; i++) {
  if (i === 2) break outerLoop;
}`,
  },

  callbackContinueUntouched: {
    name: 'forToWhile does not rewrite a continue inside a callback function',
    input: `for (var i = 0; i < 3; i++) {
  arr.forEach(function (e) {
    for (var j = 0; j < 3; j++) {
      if (e === j) continue;
    }
  });
}`,
  },

  returnInsideBody: {
    name: 'forToWhile preserves a return inside the body',
    input: `function find(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === 7) return i;
  }
  return -1;
}`,
  },

  forInUntouched: {
    name: 'forToWhile leaves for-in alone',
    input: `for (var k in obj) {
  log(k);
}`,
  },
  forOfUntouched: {
    name: 'forToWhile leaves for-of alone',
    input: `for (var v of arr) {
  log(v);
}`,
  },

  nestedFor: {
    name: 'forToWhile rewrites a nested for in the same pass with distinct labels',
    input: `for (var i = 0; i < 2; i++) {
  for (var j = 0; j < 2; j++) {
    log(i, j);
  }
}`,
  },

  adjacentForLetSameName: {
    name: 'forToWhile leaves block-scoped for-heads intact (per-iteration bindings)',
    input: `function f(arr) {
  for (let i = 0; i < 3; i++) arr.push("a" + i);
  for (let i = 0; i < 3; i++) arr.push("b" + i);
  return arr;
}`,
  },
})

test(cases.specExample.name, () => {
  const out = run(cases.specExample.input, forToWhile)
  expect(out).toMatch(/^var i = 0;/m)
  expect(out).toMatch(/while \(i < 3\)/)
  expect(out).toMatch(/_forIteration:\s*\{/)
  expect(out).toMatch(/break _forIteration/)
  expect(out).toMatch(/i\+\+;\s*\}\s*$/m)
  expect(out).not.toContain('for (')
})

function runHarness(prelude: string, body: string, epilogue = ''): unknown[] {
  const arr: unknown[] = []
  new Function('out', `${prelude}\n${body}\n${epilogue}`)(arr)
  return arr
}

test(cases.noInit.name, () => {
  const out = run(cases.noInit.input, forToWhile)
  expect(out).toMatch(/while \(i < 3\)/)
  expect(out).toMatch(/i\+\+/)
  expect(out.split('while')[0]?.trim()).toBe('')
})

test(cases.noTest.name, () => {
  const out = run(cases.noTest.input, forToWhile)
  expect(out).toMatch(/while \(true\)/)
  expect(out).toContain('var i = 0')
})

test(cases.noUpdate.name, () => {
  const out = run(cases.noUpdate.input, forToWhile)
  expect(out).toMatch(/while \(i < 3\)/)
  expect(out.match(/i\+\+/g)?.length).toBe(1)
  const r = runHarness('var calls = 0;\nfunction log() { calls++; }', out, 'out.push(calls);')
  expect(r).toEqual([3])
})

test(cases.emptyHeader.name, () => {
  const out = run(cases.emptyHeader.input, forToWhile)
  expect(out).toMatch(/while \(true\)/)
  expect(out).toContain('break;')
})

test(cases.expressionInit.name, () => {
  const out = run(cases.expressionInit.input, forToWhile)
  expect(out).toMatch(/^i = 0;/m)
  expect(out).toMatch(/while \(i < 3\)/)
})

test(cases.multiDeclaratorInit.name, () => {
  const out = run(cases.multiDeclaratorInit.input, forToWhile)
  expect(out).toMatch(/^var i = 0,\s*j = 10;/m)
})

test(cases.unlabeledContinueRewritten.name, () => {
  const out = run(cases.unlabeledContinueRewritten.input, forToWhile)
  expect(out).toMatch(/break _forIteration/)
  expect(out).not.toMatch(/\bcontinue;/)
  const r = runHarness('function log(i) { out.push(i); }', out)
  expect(r).toEqual([0, 2])
})

test(cases.unlabeledContinueInsideNestedLoopUntouched.name, () => {
  const out = run(cases.unlabeledContinueInsideNestedLoopUntouched.input, forToWhile)
  expect(out).toMatch(/while \(cond\(\)\)\s*\{\s*continue;\s*\}/)
})

test(cases.labeledContinueOnOurFor.name, () => {
  const out = run(cases.labeledContinueOnOurFor.input, forToWhile)
  expect(out).toMatch(/outerLoop:\s*while/)
  expect(out).toMatch(/break _forIteration/)
  expect(out).not.toContain('continue outerLoop')
})

test(cases.labeledContinueFromInsideNestedLoop.name, () => {
  const out = run(cases.labeledContinueFromInsideNestedLoop.input, forToWhile)
  expect(out).toContain('break _forIteration')
  expect(out).not.toContain('continue outerLoop')
})

test(cases.labeledContinueOtherLabel.name, () => {
  const out = run(cases.labeledContinueOtherLabel.input, forToWhile)
  expect(out).toContain('continue someOther')
})

test(cases.unlabeledBreakUntouched.name, () => {
  const out = run(cases.unlabeledBreakUntouched.input, forToWhile)
  expect(out).toMatch(/if \(i === 2\)\s*break;/)
  const r = runHarness('function log(i) { out.push(i); }', out)
  expect(r).toEqual([0, 1])
})

test(cases.labeledBreakUntouched.name, () => {
  const out = run(cases.labeledBreakUntouched.input, forToWhile)
  expect(out).toContain('break outerLoop')
})

test(cases.callbackContinueUntouched.name, () => {
  const out = run(cases.callbackContinueUntouched.input, forToWhile)
  const labels = [...out.matchAll(/break (_forIteration\d*)/g)].map((m) => m[1])
  expect(labels.length).toBeGreaterThan(0)
})

test(cases.returnInsideBody.name, () => {
  const out = run(cases.returnInsideBody.input, forToWhile)
  const r = runHarness(out, '', 'out.push(find([1, 7, 9])); out.push(find([2, 4]));')
  expect(r).toEqual([1, -1])
})

test(cases.forInUntouched.name, () => {
  expect(run(cases.forInUntouched.input, forToWhile)).toContain('for (var k in obj)')
})

test(cases.forOfUntouched.name, () => {
  expect(run(cases.forOfUntouched.input, forToWhile)).toContain('for (var v of arr)')
})

test(cases.nestedFor.name, () => {
  const out = run(cases.nestedFor.input, forToWhile)
  expect((out.match(/while/g) ?? []).length).toBe(2)
  expect(out).not.toMatch(/_forIteration/)
  const r = runHarness('function log(i, j) { out.push([i, j]); }', out)
  expect(r).toEqual([
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ])
})

test(cases.adjacentForLetSameName.name, () => {
  const out = run(cases.adjacentForLetSameName.input, forToWhile)
  // A lexical loop head needs its per-iteration binding.
  expect(out).toContain('for (let i = 0;')
  expect(() => new Function(out)).not.toThrow()
  const r = runHarness(out, '', 'out.push(f([]).join(","));')
  expect(r).toEqual(['a0,a1,a2,b0,b1,b2'])
})

test('forToWhile preserves per-iteration let bindings captured by a closure', () => {
  const src =
    'var fns = []; for (let i = 0; i < 3; i++) { fns.push(function () { return i; }); } out.push(fns.map(function (f) { return f(); }).join(","));'
  const out = run(src, forToWhile)
  const before = runHarness('', src)
  const after = runHarness('', out)
  expect(after).toEqual(before)
  expect(after).toEqual(['0,1,2'])
})

test('forToWhile does not let a body binding capture an update reference', () => {
  const src =
    'globalThis.Zed4 = { v: 1 }; var acc = []; for (var i = 0; i < 3; i = i + Zed4.v) { class Zed4 { static v = 2; } acc.push(i + ":" + Zed4.v); } delete globalThis.Zed4; out.push(acc.join(","));'
  const before = runHarness('', src)
  const after = runHarness('', run(src, forToWhile))
  expect(after).toEqual(before)
})

test('forToWhile does not collide the inner label with an enclosing user label', () => {
  const src =
    'var out2 = [];\n_forIteration: for (var i = 0; i < 2; i++) { continue _forIteration; }\nout.push("ok");'
  const out = run(src, forToWhile)
  expect(() => new Function('out', out)).not.toThrow()
})

function runForToWhile(code: string): { trace: unknown[]; threw: string | null } {
  const trace: unknown[] = []
  const record = (...args: unknown[]): void => {
    trace.push(args.length === 1 ? args[0] : args)
  }
  try {
    new Function('record', code)(record)
    return { trace, threw: null }
  } catch (error) {
    return { trace, threw: (error as Error).constructor.name }
  }
}

function expectForToWhilePreserves(src: string): void {
  expect(runForToWhile(run(src, forToWhile))).toEqual(runForToWhile(src))
}

// A08-05: A `with` body is a non-list slot. Its loop initializer must remain in
// the same `with` scope.
test('forToWhile keeps the hoisted init when the loop is a with body (A08-05)', () => {
  const varInit = 'var o = { n: 0 }; with (o) for (var i = 0; i < 2; i++) { record("i", i); }'
  const varOut = run(varInit, forToWhile)
  expect(varOut).toContain('var i = 0')
  expect(varOut).toMatch(/while \(i < 2\)/)
  expectForToWhilePreserves(varInit)

  expectForToWhilePreserves(
    'var o = { n: 0 }; var i; with (o) for (i = 0; i < 2; i++) { record("i", i); }',
  )
})

// A08-06: In the same slot, the outermost path may be a labeled statement.
test('forToWhile handles a labelled for used as a with body (A08-06)', () => {
  const src =
    'var o = { n: 0 }; with (o) L: for (var i = 0; i < 2; i++) { if (i === 0) continue L; record("i", i); }'
  expect(() => run(src, forToWhile)).not.toThrow()
  expectForToWhilePreserves(src)
})
