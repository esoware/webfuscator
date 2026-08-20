import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import { expect, test } from 'vitest'

import { foldConstants } from 'src/transforms/fold-constants'

import { defineCases, run, trace } from '../helpers'

const cases = defineCases('fold-constants', foldConstants, {
  notZero: {
    name: 'foldConstants reduces !0 to true',
    input: `var x = !0;`,
  },
  notNonZero: {
    name: 'foldConstants reduces a negated non-zero number to false',
    input: `var x = !231283;`,
  },
  notNonEmptyString: {
    name: 'foldConstants reduces a negated non-empty string to false',
    input: `var x = !"foo";`,
  },
  notUndefined: {
    name: 'foldConstants reduces !undefined to true',
    input: `var x = !undefined;`,
  },
  doubleNot: {
    name: 'foldConstants fully reduces a double-negated literal',
    input: `var x = !!0;`,
  },
  unaryPlus: {
    name: 'foldConstants reduces +"5" to a number literal',
    input: `var x = +"5";`,
  },
  unaryNegateExpression: {
    name: 'foldConstants reduces -(-5) back to 5',
    input: `var x = -(-5);`,
  },
  bitwiseNot: {
    name: 'foldConstants reduces ~5 to -6',
    input: `var x = ~5;`,
  },
  typeofLiteral: {
    name: 'foldConstants reduces typeof on a literal to its type string',
    input: `var x = typeof 5;
var y = typeof "foo";`,
  },

  voidLiteral: {
    name: 'foldConstants reduces void 0 to undefined',
    input: `var u = void 0;`,
  },
  voidStringInsideFn: {
    name: 'foldConstants reduces void on a string literal inside a function',
    input: `function f() {
  return void "ignored";
}`,
  },
  voidBoundIdentifier: {
    name: 'foldConstants reduces void on a bound identifier with unknown value',
    input: `const a = compute();
var u = void a;`,
  },
  leavesVoidCallExpression: {
    name: 'foldConstants leaves void on a call expression alone',
    input: `var u = void f();`,
  },
  leavesVoidUnboundIdentifier: {
    name: 'foldConstants leaves void on an unbound identifier alone',
    input: `var u = void someVar;`,
  },

  addition: {
    name: 'foldConstants reduces 2 + 3 to 5',
    input: `var x = 2 + 3;`,
  },
  subtractionToNegative: {
    name: 'foldConstants reduces 1 - 5 to -4',
    input: `var x = 1 - 5;`,
  },
  multiplication: {
    name: 'foldConstants reduces 4 * 2 to 8',
    input: `var x = 4 * 2;`,
  },
  division: {
    name: 'foldConstants reduces 8 / 2 to 4',
    input: `var x = 8 / 2;`,
  },
  modulo: {
    name: 'foldConstants reduces 7 % 3 to 1',
    input: `var x = 7 % 3;`,
  },
  exponent: {
    name: 'foldConstants reduces 2 ** 3 to 8',
    input: `var x = 2 ** 3;`,
  },
  divisionByZero: {
    name: 'foldConstants leaves 1 / 0 alone (would produce Infinity)',
    input: `var x = 1 / 0;`,
  },
  zeroOverZero: {
    name: 'foldConstants leaves 0 / 0 alone (would produce NaN)',
    input: `var x = 0 / 0;`,
  },
  nestedArithmetic: {
    name: 'foldConstants reduces nested arithmetic in a single pass',
    input: `var x = 2 + 3 * 4;`,
  },
  parenthesizedNested: {
    name: 'foldConstants reduces (1 + 2) * (3 + 4)',
    input: `var x = (1 + 2) * (3 + 4);`,
  },

  bitwiseAnd: {
    name: 'foldConstants reduces 5 & 3 to 1',
    input: `var x = 5 & 3;`,
  },
  shiftLeft: {
    name: 'foldConstants reduces 1 << 4 to 16',
    input: `var x = 1 << 4;`,
  },

  stringConcat: {
    name: 'foldConstants concatenates two string literals',
    input: `var x = "a" + "b";`,
  },
  stringConcatChain: {
    name: 'foldConstants concatenates a chain of string literals',
    input: `var x = "hello " + "world" + "!";`,
  },

  lessThan: {
    name: 'foldConstants reduces 1 < 2 to true',
    input: `var x = 1 < 2;`,
  },
  strictEquals: {
    name: 'foldConstants reduces 5 === 5 to true',
    input: `var x = 5 === 5;`,
  },
  stringStrictEquals: {
    name: 'foldConstants reduces "a" === "b" to false',
    input: `var x = "a" === "b";`,
  },

  logicalAndTruthy: {
    name: 'foldConstants reduces true && x to x',
    input: `var y = true && x;`,
  },
  logicalAndFalsy: {
    name: 'foldConstants reduces false && x to false',
    input: `var y = false && x;`,
  },
  logicalOrTruthy: {
    name: 'foldConstants reduces true || x to true',
    input: `var y = true || x;`,
  },
  logicalOrFalsy: {
    name: 'foldConstants reduces false || x to x',
    input: `var y = false || x;`,
  },
  nullishCoalesceNull: {
    name: 'foldConstants reduces null ?? x to x',
    input: `var y = null ?? x;`,
  },
  nullishCoalesceValue: {
    name: 'foldConstants reduces 5 ?? x to 5',
    input: `var y = 5 ?? x;`,
  },

  ternaryTrue: {
    name: 'foldConstants picks the consequent when the test is statically true',
    input: `var y = true ? a : b;`,
  },
  ternaryFalse: {
    name: 'foldConstants picks the alternate when the test is statically false',
    input: `var y = false ? a : b;`,
  },
  ternaryComputedTest: {
    name: 'foldConstants picks a branch when the test folds to a known value',
    input: `var y = 1 < 2 ? a : b;`,
  },

  resolvesConstBoundIdentifier: {
    name: 'foldConstants resolves a const-bound identifier in arithmetic',
    input: `const a = 5;
var x = a + 3;`,
  },
  resolvesConstChain: {
    name: 'foldConstants follows a chain of const aliases',
    input: `const a = 0;
const b = a;
var x = !b;`,
  },
  resolvesLetBinding: {
    name: 'foldConstants resolves a never-reassigned let binding',
    input: `let a = 5;
var x = !a;`,
  },
  resolvesVarBinding: {
    name: 'foldConstants resolves a never-reassigned var binding',
    input: `var a = 5;
var x = !a;`,
  },
  resolvesFunctionDeclaration: {
    name: 'foldConstants reduces a negated function declaration to false',
    input: `function f() {}
var x = !f;`,
  },
  resolvesClassDeclaration: {
    name: 'foldConstants reduces a negated class declaration to false',
    input: `class C {}
var x = !C;`,
  },

  doesNotResolveReassignedLet: {
    name: 'foldConstants does not resolve a reassigned let binding',
    input: `let a = 5;
a = 0;
var x = !a;`,
  },
  doesNotResolveReassignedFunction: {
    name: 'foldConstants does not resolve a reassigned function declaration',
    input: `function f() {}
f = 0;
var x = !f;`,
  },
  doesNotResolveDestructuredConst: {
    name: 'foldConstants does not resolve a destructured const binding',
    input: `const obj = "x";
const { a } = obj;
var y = !a;`,
  },
  doesNotResolveForwardConst: {
    name: 'foldConstants does not resolve a forward const reference (TDZ)',
    input: `const a = !b;
const b = 5;`,
  },
  doesNotFoldClassTdzSameScope: {
    name: 'foldConstants does not fold a same-scope class reference declared later',
    input: `var x = !C;
class C {}`,
  },
  doesNotFoldForwardClosure: {
    name: 'foldConstants does not fold a closure reference whose binding is declared after the closure',
    input: `function g() {
  return !y;
}
const y = 5;`,
  },
  doesNotFoldBackwardClosure: {
    name: 'foldConstants does not fold a closure reference whose binding is declared before the closure',
    input: `const y = 5;
function g() {
  return !y;
}`,
  },
  leavesUnboundIdentifierNegationAlone: {
    name: 'foldConstants leaves a negated unbound identifier alone',
    input: `var x = !a;`,
  },
  leavesCallExpressionNegationAlone: {
    name: 'foldConstants leaves a negated call expression alone',
    input: `var x = !f();`,
  },
  doesNotFoldArithmeticWithUnknown: {
    name: 'foldConstants does not fold arithmetic with an unknown operand',
    input: `var x = a + 3;`,
  },

  resolvesVarInLoopBodyWithLiteralInit: {
    name: 'foldConstants resolves a var-with-literal-init declared inside a loop body',
    input: `function f() {
  for (var i = 0; i < 3; i++) {
    var color = 16720418;
    log(color >> 16 & 255);
  }
}`,
  },
  resolvesVarInForOfBody: {
    name: 'foldConstants resolves a var-with-literal-init in a for-of body',
    input: `function f(items) {
  for (var item of items) {
    var c = 0xff2222;
    log(c & 255);
  }
}`,
  },
  doesNotResolveVarInLoopBodyWithExtraAssignment: {
    name: 'foldConstants leaves a loop-body var alone when reassigned in addition to its init',
    input: `function f(cond) {
  for (var i = 0; i < 3; i++) {
    var c = 0xff2222;
    if (cond) c = 0;
    log(c & 255);
  }
}`,
  },
  doesNotChainLoopBodyVarThroughCrossFunctionConst: {
    name: 'foldConstants does not chain a loop-body var init through an outer const read across a function boundary',
    input: `const RING_COLOR = 16720418;
function f() {
  for (var i = 0; i < 3; i++) {
    var c = RING_COLOR;
    log(c >> 8 & 255);
  }
}`,
  },

  reassociateSubtractChain: {
    name: 'foldConstants reassociates a subtract chain with a single unknown',
    input: `var y = x - 4 - 8;`,
  },
  reassociateSubtractWithInterleavedUnknown: {
    name: 'foldConstants reassociates a subtract chain that interleaves an unknown subtractee',
    input: `var y = a - 4 - b - 8;`,
  },
  reassociateSubtractWithConstantBase: {
    name: 'foldConstants reassociates a subtract chain whose base is constant',
    input: `var y = 10 - x - 3;`,
  },
  reassociateMultiplyChain: {
    name: 'foldConstants reassociates a multiply chain with a single unknown',
    input: `var y = x * 2 * 3;`,
  },
  reassociateMultiplyWithInterleavedUnknown: {
    name: 'foldConstants reassociates a multiply chain that interleaves an unknown factor',
    input: `var y = 2 * x * 3 * y;`,
  },
  reassociateBitwiseAndChain: {
    name: 'foldConstants reassociates a bitwise-and chain',
    input: `var y = x & 255 & 240;`,
  },
  reassociateBitwiseOrChain: {
    name: 'foldConstants reassociates a bitwise-or chain',
    input: `var y = x | 1 | 4;`,
  },
  reassociateBigIntChain: {
    name: 'foldConstants reassociates a subtract chain of BigInts',
    input: `var y = x - 4n - 8n;`,
  },
  reassociateSkipsFloatConstants: {
    name: 'foldConstants leaves a chain with a non-integer constant alone',
    input: `var y = x - 1.5 - 0.25;`,
  },
  reassociateSkipsAddChain: {
    name: 'foldConstants leaves an add chain with an unknown operand alone',
    input: `var y = x + 4 + 8;`,
  },
  reassociateSkipsDivideChain: {
    name: 'foldConstants leaves a divide chain alone',
    input: `var y = x / 4 / 2;`,
  },
})

test(cases.notZero.name, () => {
  expect(run(cases.notZero.input, foldConstants)).toContain('var x = true')
})

test(cases.notNonZero.name, () => {
  expect(run(cases.notNonZero.input, foldConstants)).toContain('var x = false')
})

test(cases.notNonEmptyString.name, () => {
  expect(run(cases.notNonEmptyString.input, foldConstants)).toContain('var x = false')
})

test(cases.notUndefined.name, () => {
  expect(run(cases.notUndefined.input, foldConstants)).toContain('var x = true')
})

test(cases.doubleNot.name, () => {
  expect(run(cases.doubleNot.input, foldConstants)).toContain('var x = false')
})

test(cases.unaryPlus.name, () => {
  expect(run(cases.unaryPlus.input, foldConstants)).toContain('var x = 5')
})

test(cases.unaryNegateExpression.name, () => {
  expect(run(cases.unaryNegateExpression.input, foldConstants)).toContain('var x = 5')
})

test(cases.bitwiseNot.name, () => {
  expect(run(cases.bitwiseNot.input, foldConstants)).toContain('var x = -6')
})

test(cases.typeofLiteral.name, () => {
  const out = run(cases.typeofLiteral.input, foldConstants)
  expect(out).toContain('var x = "number"')
  expect(out).toContain('var y = "string"')
})

test(cases.voidLiteral.name, () => {
  expect(run(cases.voidLiteral.input, foldConstants)).toContain('var u = void 0')
})

test(cases.voidStringInsideFn.name, () => {
  expect(run(cases.voidStringInsideFn.input, foldConstants)).toContain('return void 0')
})

test(cases.voidBoundIdentifier.name, () => {
  const out = run(cases.voidBoundIdentifier.input, foldConstants)
  expect(out).toContain('var u = void 0')
  expect(out).not.toContain('void a')
})

test(cases.leavesVoidCallExpression.name, () => {
  expect(run(cases.leavesVoidCallExpression.input, foldConstants)).toContain('void f()')
})

test(cases.leavesVoidUnboundIdentifier.name, () => {
  expect(run(cases.leavesVoidUnboundIdentifier.input, foldConstants)).toContain('void someVar')
})

test(cases.addition.name, () => {
  expect(run(cases.addition.input, foldConstants)).toContain('var x = 5')
})

test(cases.subtractionToNegative.name, () => {
  expect(run(cases.subtractionToNegative.input, foldConstants)).toContain('var x = -4')
})

test(cases.multiplication.name, () => {
  expect(run(cases.multiplication.input, foldConstants)).toContain('var x = 8')
})

test(cases.division.name, () => {
  expect(run(cases.division.input, foldConstants)).toContain('var x = 4')
})

test(cases.modulo.name, () => {
  expect(run(cases.modulo.input, foldConstants)).toContain('var x = 1')
})

test(cases.exponent.name, () => {
  expect(run(cases.exponent.input, foldConstants)).toContain('var x = 8')
})

test(cases.divisionByZero.name, () => {
  expect(run(cases.divisionByZero.input, foldConstants)).toContain('var x = 1 / 0')
})

test(cases.zeroOverZero.name, () => {
  expect(run(cases.zeroOverZero.input, foldConstants)).toContain('var x = 0 / 0')
})

test(cases.nestedArithmetic.name, () => {
  expect(run(cases.nestedArithmetic.input, foldConstants)).toContain('var x = 14')
})

test(cases.parenthesizedNested.name, () => {
  expect(run(cases.parenthesizedNested.input, foldConstants)).toContain('var x = 21')
})

test(cases.bitwiseAnd.name, () => {
  expect(run(cases.bitwiseAnd.input, foldConstants)).toContain('var x = 1')
})

test(cases.shiftLeft.name, () => {
  expect(run(cases.shiftLeft.input, foldConstants)).toContain('var x = 16')
})

test(cases.stringConcat.name, () => {
  expect(run(cases.stringConcat.input, foldConstants)).toContain('var x = "ab"')
})

test(cases.stringConcatChain.name, () => {
  expect(run(cases.stringConcatChain.input, foldConstants)).toContain('var x = "hello world!"')
})

test(cases.lessThan.name, () => {
  expect(run(cases.lessThan.input, foldConstants)).toContain('var x = true')
})

test(cases.strictEquals.name, () => {
  expect(run(cases.strictEquals.input, foldConstants)).toContain('var x = true')
})

test(cases.stringStrictEquals.name, () => {
  expect(run(cases.stringStrictEquals.input, foldConstants)).toContain('var x = false')
})

test(cases.logicalAndTruthy.name, () => {
  expect(run(cases.logicalAndTruthy.input, foldConstants)).toContain('var y = x')
})

test(cases.logicalAndFalsy.name, () => {
  expect(run(cases.logicalAndFalsy.input, foldConstants)).toContain('var y = false')
})

test(cases.logicalOrTruthy.name, () => {
  expect(run(cases.logicalOrTruthy.input, foldConstants)).toContain('var y = true')
})

test(cases.logicalOrFalsy.name, () => {
  expect(run(cases.logicalOrFalsy.input, foldConstants)).toContain('var y = x')
})

test(cases.nullishCoalesceNull.name, () => {
  expect(run(cases.nullishCoalesceNull.input, foldConstants)).toContain('var y = x')
})

test(cases.nullishCoalesceValue.name, () => {
  expect(run(cases.nullishCoalesceValue.input, foldConstants)).toContain('var y = 5')
})

test(cases.ternaryTrue.name, () => {
  expect(run(cases.ternaryTrue.input, foldConstants)).toContain('var y = a')
})

test(cases.ternaryFalse.name, () => {
  expect(run(cases.ternaryFalse.input, foldConstants)).toContain('var y = b')
})

test(cases.ternaryComputedTest.name, () => {
  expect(run(cases.ternaryComputedTest.input, foldConstants)).toContain('var y = a')
})

test(cases.resolvesConstBoundIdentifier.name, () => {
  expect(run(cases.resolvesConstBoundIdentifier.input, foldConstants)).toContain('var x = 8')
})

test(cases.resolvesConstChain.name, () => {
  expect(run(cases.resolvesConstChain.input, foldConstants)).toContain('var x = true')
})

test(cases.resolvesLetBinding.name, () => {
  expect(run(cases.resolvesLetBinding.input, foldConstants)).toContain('var x = false')
})

test(cases.resolvesVarBinding.name, () => {
  expect(run(cases.resolvesVarBinding.input, foldConstants)).toContain('var x = false')
})

test(cases.resolvesFunctionDeclaration.name, () => {
  expect(run(cases.resolvesFunctionDeclaration.input, foldConstants)).toContain('var x = false')
})

test(cases.resolvesClassDeclaration.name, () => {
  expect(run(cases.resolvesClassDeclaration.input, foldConstants)).toContain('var x = false')
})

test(cases.doesNotResolveReassignedLet.name, () => {
  expect(run(cases.doesNotResolveReassignedLet.input, foldConstants)).toContain('!a')
})

test(cases.doesNotResolveReassignedFunction.name, () => {
  expect(run(cases.doesNotResolveReassignedFunction.input, foldConstants)).toContain('!f')
})

test(cases.doesNotResolveDestructuredConst.name, () => {
  const out = run(cases.doesNotResolveDestructuredConst.input, foldConstants)
  expect(out).toContain('!a')
  expect(out).not.toContain('var y = false')
  expect(out).not.toContain('var y = true')
})

test(cases.doesNotResolveForwardConst.name, () => {
  const out = run(cases.doesNotResolveForwardConst.input, foldConstants)
  expect(out).toContain('!b')
})

test(cases.doesNotFoldClassTdzSameScope.name, () => {
  expect(run(cases.doesNotFoldClassTdzSameScope.input, foldConstants)).toContain('!C')
})

test(cases.doesNotFoldForwardClosure.name, () => {
  expect(run(cases.doesNotFoldForwardClosure.input, foldConstants)).toContain('return !y')
})

// A hoisted closure can read a lexical binding before initialization.
test(cases.doesNotFoldBackwardClosure.name, () => {
  expect(run(cases.doesNotFoldBackwardClosure.input, foldConstants)).toContain('return !y')
})

test(cases.leavesUnboundIdentifierNegationAlone.name, () => {
  expect(run(cases.leavesUnboundIdentifierNegationAlone.input, foldConstants)).toContain('!a')
})

test(cases.leavesCallExpressionNegationAlone.name, () => {
  expect(run(cases.leavesCallExpressionNegationAlone.input, foldConstants)).toContain('!f()')
})

test(cases.resolvesVarInLoopBodyWithLiteralInit.name, () => {
  const out = run(cases.resolvesVarInLoopBodyWithLiteralInit.input, foldConstants)
  expect(out).toContain('log(255)')
  expect(out).not.toContain('color >> 16')
})

test(cases.resolvesVarInForOfBody.name, () => {
  const out = run(cases.resolvesVarInForOfBody.input, foldConstants)
  expect(out).toContain('log(34)')
})

test(cases.doesNotResolveVarInLoopBodyWithExtraAssignment.name, () => {
  const out = run(cases.doesNotResolveVarInLoopBodyWithExtraAssignment.input, foldConstants)
  expect(out).toContain('c & 255')
  expect(out).not.toMatch(/log\(\d+\)/)
})

// The initializer crosses a function boundary to a lexical binding that may
// still be in TDZ.
test(cases.doesNotChainLoopBodyVarThroughCrossFunctionConst.name, () => {
  const out = run(cases.doesNotChainLoopBodyVarThroughCrossFunctionConst.input, foldConstants)
  expect(out).toContain('c >> 8 & 255')
})

test(cases.doesNotFoldArithmeticWithUnknown.name, () => {
  expect(run(cases.doesNotFoldArithmeticWithUnknown.input, foldConstants)).toContain('a + 3')
})

function evaluatesEqual(input: string, transformed: string, vars: Record<string, unknown>): void {
  const params = Object.keys(vars)
  const args = params.map((k) => vars[k])
  const before = new Function(...params, `return (${input});`)(...args)
  const after = new Function(...params, `return (${transformed});`)(...args)
  expect(after).toBe(before)
}

// IEEE-754 subtraction and multiplication cannot be reassociated. BigInt can.
test(cases.reassociateSubtractChain.name, () => {
  const out = run(cases.reassociateSubtractChain.input, foldConstants)
  expect(out).toMatch(/x - 4 - 8/)
})

test(cases.reassociateSubtractWithInterleavedUnknown.name, () => {
  const out = run(cases.reassociateSubtractWithInterleavedUnknown.input, foldConstants)
  expect(out).toMatch(/a - 4 - b - 8/)
})

test(cases.reassociateSubtractWithConstantBase.name, () => {
  const out = run(cases.reassociateSubtractWithConstantBase.input, foldConstants)
  expect(out).toMatch(/10 - x - 3/)
})

test(cases.reassociateMultiplyChain.name, () => {
  const out = run(cases.reassociateMultiplyChain.input, foldConstants)
  expect(out).toMatch(/x \* 2 \* 3/)
})

test(cases.reassociateMultiplyWithInterleavedUnknown.name, () => {
  const out = run(cases.reassociateMultiplyWithInterleavedUnknown.input, foldConstants)
  expect(out).toMatch(/2 \* x \* 3 \* y/)
})

test(cases.reassociateBitwiseAndChain.name, () => {
  const out = run(cases.reassociateBitwiseAndChain.input, foldConstants)
  expect(out).toContain('x & 240')
  expect(out).not.toMatch(/x & 255 & 240/)
  evaluatesEqual('x & 255 & 240', out.replace(/^var y = /, '').replace(/;$/, ''), { x: 0xabcd })
})

test(cases.reassociateBitwiseOrChain.name, () => {
  const out = run(cases.reassociateBitwiseOrChain.input, foldConstants)
  expect(out).toContain('x | 5')
  evaluatesEqual('x | 1 | 4', out.replace(/^var y = /, '').replace(/;$/, ''), { x: 0x10 })
})

test(cases.reassociateBigIntChain.name, () => {
  const out = run(cases.reassociateBigIntChain.input, foldConstants)
  expect(out).toContain('x - 12n')
})

test(cases.reassociateSkipsFloatConstants.name, () => {
  const out = run(cases.reassociateSkipsFloatConstants.input, foldConstants)
  expect(out).toMatch(/x - 1\.5 - 0\.25/)
})

test(cases.reassociateSkipsAddChain.name, () => {
  const out = run(cases.reassociateSkipsAddChain.input, foldConstants)
  expect(out).toMatch(/x \+ 4 \+ 8/)
})

test(cases.reassociateSkipsDivideChain.name, () => {
  const out = run(cases.reassociateSkipsDivideChain.input, foldConstants)
  expect(out).toMatch(/x \/ 4 \/ 2/)
})

// Compare logs and thrown classes before and after folding.

function expectFoldPreservesBehavior(src: string): string {
  const out = run(src, foldConstants)
  expect(trace(out)).toEqual(trace(src))
  return out
}

test('foldConstants does not reassociate a number multiply chain (IEEE-754 rounding)', () => {
  expectFoldPreservesBehavior('function f(x){ return x * 3 * 7; } log(f(0.1));')
})

test('foldConstants does not reassociate a number subtract chain (IEEE-754 rounding)', () => {
  expectFoldPreservesBehavior('function f(x){ return x - 1 - 2; } log(f(9007199254740994));')
})

test('foldConstants reassociates a BigInt multiply chain', () => {
  const out = run('var y = x * 2n * 3n;', foldConstants)
  expect(out).toContain('x * 6n')
})

test('foldConstants does not produce a bare -0 literal or crash on a zeroing chain', () => {
  expect(() => run('var y = x * 0 * -1;', foldConstants)).not.toThrow()
  expectFoldPreservesBehavior('var x = 3; log(1 / (x * 0 * -1));')
})

test('foldConstants leaves unary + on a BigInt alone (it throws TypeError)', () => {
  const out = run('var n = +1n;', foldConstants)
  expect(out).toContain('+1n')
  expect(out).not.toMatch(/var n = 1\b/)
  expectFoldPreservesBehavior('try { log(+1n); } catch (error) { log(error.constructor.name); }')
  expectFoldPreservesBehavior(
    'const x = 5n; try { log(+x); } catch (error) { log(error.constructor.name); }',
  )
})

test('foldConstants does not treat a function binding as an object value', () => {
  const out = run(
    'function f(){} var a = typeof f; var b = f === f; var c = "" + f;',
    foldConstants,
  )
  expect(out).not.toContain('"object"')
  expect(out).not.toContain('[object Object]')
  expectFoldPreservesBehavior('function f(){} log(typeof f);')
  expectFoldPreservesBehavior('function f(){} const g = f; log(typeof g);')
})

test('foldConstants does not treat a class binding as an object value', () => {
  const out = run('class C {} var a = typeof C;', foldConstants)
  expect(out).toContain('typeof C')
  expect(out).not.toContain('"object"')
  expectFoldPreservesBehavior('class C{} log(typeof C, C === C);')
})

test('foldConstants keeps a function/class binding foldable for truthiness', () => {
  expect(run('function f(){} var x = !f;', foldConstants)).toContain('var x = false')
  expect(run('class C {} var x = !C;', foldConstants)).toContain('var x = false')
})

test('foldConstants does not fold a conditional or logical in callee position', () => {
  const cond = run(
    'let o = { m(){ return this && this.t }, t: "M" }; var c = true; var r = (c ? o.m : o.m)();',
    foldConstants,
  )
  expect(cond).toContain('(c ? o.m : o.m)()')
  expectFoldPreservesBehavior(
    'let o = { m(){ return this.t }, t: "M" }; let c = true; log((c ? o.m : o.m)());',
  )
})

test('foldConstants does not treat a regexp literal as an object value', () => {
  const out = run('var s = "" + /ab/; var e = /ab/ == "/ab/";', foldConstants)
  expect(out).not.toContain('[object Object]')
  expectFoldPreservesBehavior('log("" + /ab/);')
  expectFoldPreservesBehavior('log(/ab/ + 1);')
})

test('foldConstants does not fold a var declared only in a conditional branch', () => {
  const out = run('function f(c){ if (c) { var x = 5; } return typeof x; }', foldConstants)
  expect(out).toContain('typeof x')
  expect(out).not.toContain('"number"')
  expectFoldPreservesBehavior('function f(c){ if (c) { var x = 5; } return typeof x; } log(f(0));')
  expectFoldPreservesBehavior('function f(c){ if (c) { var x = 5; } return x + 1; } log(f(0));')
  expectFoldPreservesBehavior(
    'function f(n){ while (n) { var x = 5; n = 0; } return typeof x; } log(f(0));',
  )
  // A declaration in an unentered switch case has not run.
  const switchOut = run(
    'function f(){ switch (2) { case 1: var v = 1; case 2: return typeof v; } }',
    foldConstants,
  )
  expect(switchOut).toContain('typeof v')
  expect(switchOut).not.toContain('"number"')
})

// Cloned nodes lack source offsets, and the nested read can still run while `X`
// is in TDZ. Path order must handle both without folding or crashing.
test('foldConstants leaves a cross-function reference unfolded even when source positions are stripped', () => {
  const code = `const X = 5;
function f() {
  return !X;
}
f();`
  const ast = parse(code, { sourceType: 'unambiguous' })
  traverse(ast, {
    enter(p: NodePath) {
      const n = p.node as t.Node & {
        start?: number | null
        end?: number | null
        loc?: unknown
      }
      n.start = null
      n.end = null
      n.loc = null
    },
  })
  foldConstants(ast)
  const out = generate(ast, { comments: false }).code
  expect(out).toContain('return !X')
})

// A05-01/02/03: Delete distinguishes a value from an identifier or member
// reference.
test('foldConstants does not fold a conditional inside delete', () => {
  const src = 'var o = { b: 1 }; log(delete (true ? o.b : o.c)); log(o.b);'
  expect(run(src, foldConstants)).toContain('delete (true ? o.b : o.c)')
  expectFoldPreservesBehavior(src)
})

test('foldConstants does not fold a logical inside delete', () => {
  const src = 'var k = 1; log(delete (0 || k));'
  expect(run(src, foldConstants)).toContain('delete (0 || k)')
  expectFoldPreservesBehavior(src)
})

test('foldConstants does not fold a logical inside delete under strict mode', () => {
  const src = '"use strict"; var k = 1; log(delete (0 || k));'
  expect(run(src, foldConstants)).not.toMatch(/delete k\b/)
  expectFoldPreservesBehavior(src)
})

// A05-04: `typeof` suppresses ReferenceError only for a direct unresolved name.
test('foldConstants does not fold a conditional inside typeof', () => {
  expect(run('log(typeof (true ? nope : 1));', foldConstants)).toContain('typeof (true ? nope : 1)')
  expectFoldPreservesBehavior('log(typeof (true ? nope : 1));')
})

test('foldConstants does not fold a logical inside typeof', () => {
  expect(run('log(typeof (1 && nope));', foldConstants)).toContain('typeof (1 && nope)')
  expectFoldPreservesBehavior('log(typeof (1 && nope));')
})

// A05-15/16: Reassociation must not move coercion across a call.
test('foldConstants does not reassociate a bitwise chain past a coercion and a call', () => {
  const src =
    'var o = { valueOf: function () { log("vo"); return 1; } }; function y() { log("y"); return 2; } log(o & 5 & y() & 3);'
  expect(run(src, foldConstants)).toContain('o & 5 & y() & 3')
  expectFoldPreservesBehavior(src)
})

test('foldConstants does not reassociate a chain that would run a coercion the original never reaches', () => {
  const src =
    'var t = { toString: function () { log("t"); return "7"; } }; function b() { return 5n; } try { log(b() ^ 0 ^ t ^ 0); } catch (e) { log("caught"); }'
  expect(run(src, foldConstants)).toContain('b() ^ 0 ^ t ^ 0')
  expectFoldPreservesBehavior(src)
})

test('foldConstants does not reassociate a subtraction chain past a coercion and a call', () => {
  const src =
    'var o = { valueOf: function () { log("vo"); return 10n; } }; function y() { log("y"); return 1n; } log(o - 2n - y() - 3n);'
  expect(run(src, foldConstants)).toContain('o - 2n - y() - 3n')
  expectFoldPreservesBehavior(src)
})

// One non-constant operand has no other active operand to reorder against.
test('foldConstants still reassociates a single-call bitwise chain', () => {
  const src = 'function g(){ log("g"); return 6; } log(g() & 255 & 240);'
  expect(run(src, foldConstants)).toContain('g() & 240')
  expectFoldPreservesBehavior(src)
})

// A stale binding path must not crash trivial conditional folding.
test('foldConstants does not throw folding a conditional over a bound var', () => {
  expect(() => run('var a = 0, b = 1; a ? 1 : 2;', foldConstants)).not.toThrow()
  expectFoldPreservesBehavior('var a = 0, b = 1; log(a ? 1 : 2);')
})
