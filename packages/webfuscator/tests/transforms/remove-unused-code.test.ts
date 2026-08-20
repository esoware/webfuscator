import { expect, test } from 'vitest'

import { removeUnusedCode } from 'src/transforms/remove-unused-code'

import { defineCases, run, trace } from '../helpers'

const cases = defineCases('remove-unused-code', removeUnusedCode, {
  specExample: {
    name: 'removeUnusedCode drops an unused function and an unused literal var, keeps the called one',
    input: `function foo() {
  return "foo";
}
function bar() {
  return "bar";
}
var unused = 1;
foo();`,
  },

  unusedVarLiteral: {
    name: 'removeUnusedCode drops a never-referenced var with a literal init',
    input: `var x = 1;`,
  },
  unusedVarNoInit: {
    name: 'removeUnusedCode drops a never-referenced var with no init',
    input: `var x;`,
  },
  unusedConstLiteral: {
    name: 'removeUnusedCode drops a never-referenced const',
    input: `const x = 1;`,
  },
  usedVar: {
    name: 'removeUnusedCode keeps a var that is read',
    input: `var x = 1;
log(x);`,
  },
  reassignedVarUnused: {
    name: 'removeUnusedCode keeps a never-read var when it is reassigned (the assignment is observable)',
    input: `var x = 1;
x = 2;`,
  },
  varWithSideEffectfulInit: {
    name: 'removeUnusedCode keeps a never-read var whose init has side effects',
    input: `var x = compute();`,
  },
  destructuredVar: {
    name: 'removeUnusedCode keeps a destructuring var even when none of its bindings are read',
    input: `var { a, b } = obj;`,
  },

  unusedFunction: {
    name: 'removeUnusedCode drops a never-referenced function declaration',
    input: `function f() {
  return 1;
}`,
  },
  usedFunction: {
    name: 'removeUnusedCode keeps a function declaration that is called',
    input: `function f() {
  return 1;
}
f();`,
  },
  recursiveFunctionUnused: {
    name: 'removeUnusedCode keeps a recursive function declaration whose only ref is the recursive call',
    input: `function f(n) {
  return n <= 1 ? 1 : f(n - 1);
}`,
  },

  unusedClass: {
    name: 'removeUnusedCode drops a never-referenced class declaration with no static members',
    input: `class A {
  m() {}
}`,
  },
  usedClass: {
    name: 'removeUnusedCode keeps a class that is instantiated',
    input: `class A {}
new A();`,
  },
  classWithStaticBlockKept: {
    name: 'removeUnusedCode keeps a never-referenced class that has a static block (side effects)',
    input: `class A {
  static {
    register();
  }
}`,
  },

  literalExpressionStatement: {
    name: 'removeUnusedCode drops a literal expression statement',
    input: `1;
"foo";
true;`,
  },
  identifierExpressionStatementBound: {
    name: 'removeUnusedCode drops an expression statement that is just a bound identifier read',
    input: `var x = 1;
x;
log(x);`,
  },
  identifierExpressionStatementUnbound: {
    name: 'removeUnusedCode keeps an expression statement that is an unbound identifier read (would throw)',
    input: `unbound;`,
  },
  callExpressionStatement: {
    name: 'removeUnusedCode keeps an expression statement that is a call (side effects)',
    input: `foo();`,
  },

  fixedPointCascade: {
    name: 'removeUnusedCode iterates so a freshly-orphaned binding is also removed',
    input: `function helper() {
  return "x";
}
function consumer() {
  return helper();
}`,
  },

  unusedFunctionExpressionInit: {
    name: 'removeUnusedCode drops a never-referenced var holding a function expression',
    input: `var u = function () {
  return 1;
};`,
  },
  unusedArrowExpressionInit: {
    name: 'removeUnusedCode drops a never-referenced var holding an arrow function',
    input: `var u = (n) => n + 1;`,
  },
  unusedObjectLiteralInit: {
    name: 'removeUnusedCode drops a never-referenced var holding a plain object literal',
    input: `var u = {
  a: 1,
  b: "two"
};`,
  },
  unusedArrayLiteralInit: {
    name: 'removeUnusedCode drops a never-referenced var holding a plain array literal',
    input: `var u = [1, 2, 3];`,
  },
  unusedArithmeticInit: {
    name: 'removeUnusedCode drops a never-referenced var holding a pure arithmetic expression',
    input: `var a = 1;
var u = 3 + 2;
log(a);`,
  },
  keepsArithmeticOverIdentifier: {
    name: 'removeUnusedCode keeps a never-referenced var whose arithmetic init reads an identifier',
    input: `var a = 1;
var u = a + 2;
log(a);`,
  },
  keepsObjectInitWithSpread: {
    name: 'removeUnusedCode keeps a never-referenced var whose object init has a spread',
    input: `var u = { ...other, foo: 1 };`,
  },
  keepsArrayInitWithSpread: {
    name: 'removeUnusedCode keeps a never-referenced var whose array init has a spread',
    input: `var u = [1, ...rest];`,
  },
  keepsClassWithStaticBlockInit: {
    name: 'removeUnusedCode keeps a never-referenced var whose class init has a static block',
    input: `var u = class {
  static {
    register();
  }
};`,
  },
  bareFunctionExpressionStatement: {
    name: 'removeUnusedCode drops a bare function-expression statement',
    input: `(function () {
  return 1;
});`,
  },
  bareArrayLiteralStatement: {
    name: 'removeUnusedCode drops a bare array-literal expression statement',
    input: `[1, 2, 3];`,
  },
  bareLogicalOnLiteralsStatement: {
    name: 'removeUnusedCode drops a bare logical expression on literals',
    input: `1 && 2;`,
  },
  keepsBareCallStatement: {
    name: 'removeUnusedCode keeps a bare call statement (call has side effects)',
    input: `1 && f();`,
  },

  forInitVar: {
    name: 'removeUnusedCode keeps a var declared as for-loop init',
    input: `for (var i = 0; i < 3; i++) {
  step();
}`,
  },
  exportedVar: {
    name: 'removeUnusedCode keeps an exported var',
    input: `export var x = 1;`,
  },
  exportedFunction: {
    name: 'removeUnusedCode keeps an exported function',
    input: `export function f() {
  return 1;
}`,
  },
})

test(cases.specExample.name, () => {
  const out = run(cases.specExample.input, removeUnusedCode)
  expect(out).toContain('function foo')
  expect(out).toContain('foo()')
  expect(out).not.toContain('function bar')
  expect(out).not.toContain('var unused')
})

test(cases.unusedVarLiteral.name, () => {
  expect(run(cases.unusedVarLiteral.input, removeUnusedCode).trim()).toBe('')
})

test(cases.unusedVarNoInit.name, () => {
  expect(run(cases.unusedVarNoInit.input, removeUnusedCode).trim()).toBe('')
})

test(cases.unusedConstLiteral.name, () => {
  expect(run(cases.unusedConstLiteral.input, removeUnusedCode).trim()).toBe('')
})

test(cases.usedVar.name, () => {
  const out = run(cases.usedVar.input, removeUnusedCode)
  expect(out).toContain('var x = 1')
  expect(out).toContain('log(x)')
})

test(cases.reassignedVarUnused.name, () => {
  const out = run(cases.reassignedVarUnused.input, removeUnusedCode)
  expect(out).toContain('var x = 1')
  expect(out).toContain('x = 2')
})

test(cases.varWithSideEffectfulInit.name, () => {
  expect(run(cases.varWithSideEffectfulInit.input, removeUnusedCode)).toContain('var x = compute()')
})

test(cases.destructuredVar.name, () => {
  expect(run(cases.destructuredVar.input, removeUnusedCode)).toMatch(/var \{[\s\S]*\} = obj/)
})

test(cases.unusedFunction.name, () => {
  expect(run(cases.unusedFunction.input, removeUnusedCode).trim()).toBe('')
})

test(cases.usedFunction.name, () => {
  const out = run(cases.usedFunction.input, removeUnusedCode)
  expect(out).toContain('function f')
  expect(out).toContain('f()')
})

test(cases.recursiveFunctionUnused.name, () => {
  expect(run(cases.recursiveFunctionUnused.input, removeUnusedCode)).toContain('function f')
})

test(cases.unusedClass.name, () => {
  expect(run(cases.unusedClass.input, removeUnusedCode).trim()).toBe('')
})

test(cases.usedClass.name, () => {
  const out = run(cases.usedClass.input, removeUnusedCode)
  expect(out).toContain('class A')
  expect(out).toContain('new A()')
})

test(cases.classWithStaticBlockKept.name, () => {
  expect(run(cases.classWithStaticBlockKept.input, removeUnusedCode)).toContain('class A')
})

test(cases.literalExpressionStatement.name, () => {
  expect(run(cases.literalExpressionStatement.input, removeUnusedCode).trim()).toBe('')
})

test(cases.identifierExpressionStatementBound.name, () => {
  const out = run(cases.identifierExpressionStatementBound.input, removeUnusedCode)
  expect(out).toContain('var x = 1')
  expect(out).toContain('log(x)')
  expect(out.split('\n').filter((l) => l.trim() === 'x;').length).toBe(0)
})

test(cases.identifierExpressionStatementUnbound.name, () => {
  expect(run(cases.identifierExpressionStatementUnbound.input, removeUnusedCode)).toContain(
    'unbound',
  )
})

test(cases.callExpressionStatement.name, () => {
  expect(run(cases.callExpressionStatement.input, removeUnusedCode)).toContain('foo()')
})

test(cases.fixedPointCascade.name, () => {
  expect(run(cases.fixedPointCascade.input, removeUnusedCode).trim()).toBe('')
})

test(cases.unusedFunctionExpressionInit.name, () => {
  expect(run(cases.unusedFunctionExpressionInit.input, removeUnusedCode).trim()).toBe('')
})

test(cases.unusedArrowExpressionInit.name, () => {
  expect(run(cases.unusedArrowExpressionInit.input, removeUnusedCode).trim()).toBe('')
})

test(cases.unusedObjectLiteralInit.name, () => {
  expect(run(cases.unusedObjectLiteralInit.input, removeUnusedCode).trim()).toBe('')
})

test(cases.unusedArrayLiteralInit.name, () => {
  expect(run(cases.unusedArrayLiteralInit.input, removeUnusedCode).trim()).toBe('')
})

test(cases.unusedArithmeticInit.name, () => {
  const out = run(cases.unusedArithmeticInit.input, removeUnusedCode)
  expect(out).not.toContain('var u =')
  expect(out).toContain('var a = 1')
  expect(out).toContain('log(a)')
})

test(cases.keepsArithmeticOverIdentifier.name, () => {
  // An isolated pass cannot prove coercion of `a + 2` safe.
  const out = run(cases.keepsArithmeticOverIdentifier.input, removeUnusedCode)
  expect(out).toContain('var u = a + 2')
})

test(cases.keepsObjectInitWithSpread.name, () => {
  expect(run(cases.keepsObjectInitWithSpread.input, removeUnusedCode)).toMatch(/var u =/)
})

test(cases.keepsArrayInitWithSpread.name, () => {
  expect(run(cases.keepsArrayInitWithSpread.input, removeUnusedCode)).toMatch(/var u =/)
})

test(cases.keepsClassWithStaticBlockInit.name, () => {
  expect(run(cases.keepsClassWithStaticBlockInit.input, removeUnusedCode)).toMatch(/var u =/)
})

test(cases.bareFunctionExpressionStatement.name, () => {
  expect(run(cases.bareFunctionExpressionStatement.input, removeUnusedCode).trim()).toBe('')
})

test(cases.bareArrayLiteralStatement.name, () => {
  expect(run(cases.bareArrayLiteralStatement.input, removeUnusedCode).trim()).toBe('')
})

test(cases.bareLogicalOnLiteralsStatement.name, () => {
  expect(run(cases.bareLogicalOnLiteralsStatement.input, removeUnusedCode).trim()).toBe('')
})

test(cases.keepsBareCallStatement.name, () => {
  expect(run(cases.keepsBareCallStatement.input, removeUnusedCode)).toContain('f()')
})

test(cases.forInitVar.name, () => {
  expect(run(cases.forInitVar.input, removeUnusedCode)).toContain('var i = 0')
})

test(cases.exportedVar.name, () => {
  expect(run(cases.exportedVar.input, removeUnusedCode)).toContain('export var x')
})

test(cases.exportedFunction.name, () => {
  expect(run(cases.exportedFunction.input, removeUnusedCode)).toContain('export function f')
})

function preservesUnused(code: string): void {
  expect(trace(run(code, removeUnusedCode))).toEqual(trace(code))
}

test('removeUnusedCode keeps a binding reachable through direct eval (F3)', () => {
  preservesUnused("var x = 7; log(eval('x'));")
  preservesUnused("function h(){ return 3; } log(eval('h()'));")
})

test('removeUnusedCode keeps an Annex-B block function referenced at function level (F4)', () => {
  preservesUnused("function f() { if (1) { function g() { return 'g' } } return g(); } log(f());")
})

test('removeUnusedCode drops an unused block-level function in strict mode', () => {
  // ECMA-262 B.3.3 creates no block-function alias in strict mode.
  const source =
    "'use strict';\nfunction f() { { function g() { return 'g' } } return typeof g; }\nlog(f());"
  const out = run(source, removeUnusedCode)
  expect(out).not.toContain('function g')
  preservesUnused(source)
})

test('removeUnusedCode keeps a binary with coercion side effects (F5)', () => {
  preservesUnused(
    "var o = { valueOf: function(){ log('vo'); return 1 } }; var u = o + 1; log('end');",
  )
  preservesUnused("var u = 1n + 1; log('end');")
})

test('removeUnusedCode keeps a class with a computed key or side-effecting extends (F6)', () => {
  preservesUnused(
    "function k() { log('key'); return 'm' } var u = class { [k()]() {} }; log('end');",
  )
  preservesUnused(
    "function b() { log('base'); return class {}; } class U extends b() {} log('end');",
  )
})

test('removeUnusedCode keeps a TDZ read reachable from an earlier call (F7)', () => {
  preservesUnused(
    "function f() { var r = 'no-throw'; try { g() } catch (e) { r = 'threw' } let a = 1; function g() { var u = a; } return r; } log(f());",
  )
})

test('removeUnusedCode keeps a switch-case TDZ read of a later let', () => {
  preservesUnused(
    "function f(c) { switch (c) { case 1: let v = 1; break; case 2: v; log('two'); break; } } try { f(2); } catch (e) { log(e.constructor.name); }",
  )
})

test('removeUnusedCode keeps a class with a static private field initializer (A02-22)', () => {
  preservesUnused('class C { static #x = log("boom"); }\nlog("after");')
})

test('removeUnusedCode keeps an Annex-B function declared in a switch case (A02-24)', () => {
  preservesUnused(
    'function outer() { switch (1) { case 1: function h() { log("h"); } } h(); }\nouter();',
  )
})

test('removeUnusedCode keeps a class with public static fields (A02-25)', () => {
  for (const source of [
    'class U { static s = 1; }\nlog("after");',
    'class U { static a = log("a"); static b = log("b"); }\nlog("after");',
  ]) {
    const out = run(source, removeUnusedCode)
    expect(out).toContain('class U')
    expect(trace(out)).toEqual(trace(source))
  }
})
