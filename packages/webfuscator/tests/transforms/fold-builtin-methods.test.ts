import { afterEach, expect, test } from 'vitest'

import { foldBuiltinMethods } from 'src/transforms/fold-builtin-methods'

import { defineCases, run, trace } from '../helpers'

// Restore intrinsics after tests that patch them inside evaluated code.
const PRISTINE = {
  floor: Math.floor,
  round: Math.round,
  toUpperCase: String.prototype.toUpperCase,
  Boolean: globalThis.Boolean,
}

afterEach(() => {
  Math.floor = PRISTINE.floor
  Math.round = PRISTINE.round
  // oxlint-disable-next-line no-extend-native
  String.prototype.toUpperCase = PRISTINE.toUpperCase
  globalThis.Boolean = PRISTINE.Boolean
})

const cases = defineCases('fold-builtin-methods', foldBuiltinMethods, {
  mathPi: {
    name: 'foldBuiltinMethods replaces Math.PI with its numeric value',
    input: `var x = Math.PI;`,
  },
  mathE: {
    name: 'foldBuiltinMethods replaces Math.E with its numeric value',
    input: `var x = Math.E;`,
  },
  mathSqrt2: {
    name: 'foldBuiltinMethods replaces Math.SQRT2 with its numeric value',
    input: `var x = Math.SQRT2;`,
  },
  mathConstantShadowed: {
    name: 'foldBuiltinMethods leaves Math.PI alone when Math is shadowed',
    input: `function f(Math) {
  return Math.PI;
}`,
  },
  mathUnknownProperty: {
    name: 'foldBuiltinMethods leaves an unknown Math property alone',
    input: `var x = Math.NOT_A_THING;`,
  },

  mathPowSyntactic: {
    name: 'foldBuiltinMethods rewrites Math.pow as ** when one operand is a known number',
    input: `var x = Math.pow(a, 2);`,
  },
  mathPowConstants: {
    name: 'foldBuiltinMethods rewrites Math.pow on numeric literals as ** with the same operands',
    input: `var x = Math.pow(2, 3);`,
  },
  mathPowSideEffectful: {
    name: 'foldBuiltinMethods preserves the operands of Math.pow when rewriting to **',
    input: `var x = Math.pow(getX(), +getY());`,
  },
  mathPowUnknownOperands: {
    name: 'foldBuiltinMethods leaves Math.pow alone when neither operand is a proven number',
    input: `var x = Math.pow(a, b);`,
  },
  mathPowShadowed: {
    name: 'foldBuiltinMethods leaves Math.pow alone when Math is shadowed',
    input: `function f(Math) {
  return Math.pow(2, 3);
}`,
  },
  mathPowWrongArity: {
    name: 'foldBuiltinMethods leaves Math.pow alone when arity is not 2',
    input: `var x = Math.pow(2);
var y = Math.pow(2, 3, 4);`,
  },

  mathAbs: {
    name: 'foldBuiltinMethods folds Math.abs of a negative literal',
    input: `var x = Math.abs(-5);`,
  },
  mathFloor: {
    name: 'foldBuiltinMethods folds Math.floor of a constant',
    input: `var x = Math.floor(3.7);`,
  },
  mathCeil: {
    name: 'foldBuiltinMethods folds Math.ceil of a constant',
    input: `var x = Math.ceil(3.2);`,
  },
  mathRound: {
    name: 'foldBuiltinMethods folds Math.round of a constant',
    input: `var x = Math.round(3.5);`,
  },
  mathSqrt: {
    name: 'foldBuiltinMethods folds Math.sqrt of a perfect square',
    input: `var x = Math.sqrt(16);`,
  },
  mathMax: {
    name: 'foldBuiltinMethods folds Math.max of constant args',
    input: `var x = Math.max(1, 2, 3);`,
  },
  mathMin: {
    name: 'foldBuiltinMethods folds Math.min of constant args',
    input: `var x = Math.min(1, 2, 3);`,
  },
  mathHypot: {
    name: 'foldBuiltinMethods folds Math.hypot of constant args',
    input: `var x = Math.hypot(3, 4);`,
  },
  mathSign: {
    name: 'foldBuiltinMethods folds Math.sign of a negative constant',
    input: `var x = Math.sign(-7);`,
  },
  mathCbrt: {
    name: 'foldBuiltinMethods folds Math.cbrt of a perfect cube',
    input: `var x = Math.cbrt(27);`,
  },
  mathTrunc: {
    name: 'foldBuiltinMethods folds Math.trunc of a constant',
    input: `var x = Math.trunc(3.7);`,
  },
  mathClz32: {
    name: 'foldBuiltinMethods folds Math.clz32 of a constant',
    input: `var x = Math.clz32(1);`,
  },
  mathImul: {
    name: 'foldBuiltinMethods folds Math.imul of two constants',
    input: `var x = Math.imul(3, 4);`,
  },
  mathLog2: {
    name: 'foldBuiltinMethods folds Math.log2 of a power of two',
    input: `var x = Math.log2(8);`,
  },
  mathAbsUnknown: {
    name: 'foldBuiltinMethods leaves Math.abs alone when its argument is not constant',
    input: `var x = Math.abs(y);`,
  },
  mathSqrtNegative: {
    name: 'foldBuiltinMethods leaves Math.sqrt(-1) alone (would produce NaN)',
    input: `var x = Math.sqrt(-1);`,
  },
  mathLogZero: {
    name: 'foldBuiltinMethods leaves Math.log(0) alone (would produce -Infinity)',
    input: `var x = Math.log(0);`,
  },

  numberMaxSafeInt: {
    name: 'foldBuiltinMethods replaces Number.MAX_SAFE_INTEGER with its numeric value',
    input: `var x = Number.MAX_SAFE_INTEGER;`,
  },
  numberEpsilon: {
    name: 'foldBuiltinMethods replaces Number.EPSILON with its numeric value',
    input: `var x = Number.EPSILON;`,
  },

  numberIsNaN: {
    name: 'foldBuiltinMethods folds Number.isNaN on a known scalar',
    input: `var x = Number.isNaN(5);`,
  },
  numberIsFinite: {
    name: 'foldBuiltinMethods folds Number.isFinite on a known scalar',
    input: `var x = Number.isFinite(5);`,
  },
  numberIsInteger: {
    name: 'foldBuiltinMethods folds Number.isInteger on a known scalar',
    input: `var x = Number.isInteger(3);`,
  },
  numberIsSafeInteger: {
    name: 'foldBuiltinMethods folds Number.isSafeInteger on a known scalar',
    input: `var x = Number.isSafeInteger(3);`,
  },
  numberParseInt: {
    name: 'foldBuiltinMethods folds Number.parseInt on a constant string',
    input: `var x = Number.parseInt("42");`,
  },
  numberParseFloat: {
    name: 'foldBuiltinMethods folds Number.parseFloat on a constant string',
    input: `var x = Number.parseFloat("3.14");`,
  },

  numberCtorString: {
    name: 'foldBuiltinMethods folds Number(string)',
    input: `var x = Number("5");`,
  },
  numberCtorBool: {
    name: 'foldBuiltinMethods folds Number(true)',
    input: `var x = Number(true);`,
  },
  numberCtorNoArg: {
    name: 'foldBuiltinMethods replaces Number() with 0',
    input: `var x = Number();`,
  },
  numberCtorUnknown: {
    name: 'foldBuiltinMethods leaves Number(x) alone for an unknown x',
    input: `var x = Number(y);`,
  },

  stringFromCharCode: {
    name: 'foldBuiltinMethods folds String.fromCharCode of constant args',
    input: `var x = String.fromCharCode(72, 105);`,
  },
  stringFromCharCodeOne: {
    name: 'foldBuiltinMethods folds String.fromCharCode of a single arg',
    input: `var x = String.fromCharCode(65);`,
  },
  stringFromCodePoint: {
    name: 'foldBuiltinMethods folds String.fromCodePoint of constant args',
    input: `var x = String.fromCodePoint(65, 66);`,
  },

  stringCtor: {
    name: 'foldBuiltinMethods folds String(number)',
    input: `var x = String(5);`,
  },
  stringCtorBool: {
    name: 'foldBuiltinMethods folds String(true)',
    input: `var x = String(true);`,
  },
  stringCtorNull: {
    name: 'foldBuiltinMethods folds String(null)',
    input: `var x = String(null);`,
  },
  stringCtorNoArg: {
    name: 'foldBuiltinMethods replaces String() with the empty string',
    input: `var x = String();`,
  },

  booleanCtorIdent: {
    name: 'foldBuiltinMethods rewrites Boolean(x) as !!x for an unknown x',
    input: `var x = Boolean(y);`,
  },
  booleanCtorTruthy: {
    name: 'foldBuiltinMethods rewrites Boolean(1) as !!1',
    input: `var x = Boolean(1);`,
  },
  booleanCtorNoArg: {
    name: 'foldBuiltinMethods replaces Boolean() with false',
    input: `var x = Boolean();`,
  },
  booleanCtorShadowed: {
    name: 'foldBuiltinMethods leaves Boolean alone when Boolean is shadowed',
    input: `function f(Boolean) {
  return Boolean(y);
}`,
  },

  arrayOf: {
    name: 'foldBuiltinMethods rewrites Array.of as an array literal',
    input: `var x = Array.of(1, 2, 3);`,
  },
  arrayOfSpread: {
    name: 'foldBuiltinMethods rewrites Array.of with a spread arg as an array literal with spread',
    input: `var x = Array.of(...args);`,
  },
  arrayOfEmpty: {
    name: 'foldBuiltinMethods replaces Array.of() with an empty array',
    input: `var x = Array.of();`,
  },
  arrayIsArrayScalar: {
    name: 'foldBuiltinMethods folds Array.isArray of a constant string to false',
    input: `var x = Array.isArray("foo");`,
  },
  arrayIsArrayUnknown: {
    name: 'foldBuiltinMethods leaves Array.isArray of an unknown identifier alone',
    input: `var x = Array.isArray(y);`,
  },

  parseIntDecimal: {
    name: 'foldBuiltinMethods folds parseInt of a decimal string',
    input: `var x = parseInt("42");`,
  },
  parseIntRadix: {
    name: 'foldBuiltinMethods folds parseInt with an explicit radix',
    input: `var x = parseInt("0x1F", 16);`,
  },
  parseFloatGlobal: {
    name: 'foldBuiltinMethods folds parseFloat of a decimal string',
    input: `var x = parseFloat("3.14");`,
  },
  isNaNGlobal: {
    name: 'foldBuiltinMethods folds isNaN of a numeric literal',
    input: `var x = isNaN(5);`,
  },
  isFiniteGlobal: {
    name: 'foldBuiltinMethods folds isFinite of a numeric literal',
    input: `var x = isFinite(5);`,
  },
  atobGlobal: {
    name: 'foldBuiltinMethods folds atob of a constant base64 string',
    input: `var x = atob("SGk=");`,
  },
  btoaGlobal: {
    name: 'foldBuiltinMethods folds btoa of a constant ascii string',
    input: `var x = btoa("Hi");`,
  },
  encodeURIGlobal: {
    name: 'foldBuiltinMethods folds encodeURI of a constant string',
    input: `var x = encodeURI("a b");`,
  },
  encodeURIComponentGlobal: {
    name: 'foldBuiltinMethods folds encodeURIComponent of a constant string',
    input: `var x = encodeURIComponent("a b&c");`,
  },
  decodeURIGlobal: {
    name: 'foldBuiltinMethods folds decodeURI of a constant string',
    input: `var x = decodeURI("a%20b");`,
  },
  parseIntShadowed: {
    name: 'foldBuiltinMethods leaves parseInt alone when locally shadowed',
    input: `function f(parseInt) {
  return parseInt("5");
}`,
  },
  globalUnknownArg: {
    name: 'foldBuiltinMethods leaves a global call alone when its arg is not constant',
    input: `var x = parseInt(s);`,
  },

  toUpperCase: {
    name: 'foldBuiltinMethods folds toUpperCase on a string literal',
    input: `var x = "abc".toUpperCase();`,
  },
  toLowerCase: {
    name: 'foldBuiltinMethods folds toLowerCase on a string literal',
    input: `var x = "ABC".toLowerCase();`,
  },
  charAt: {
    name: 'foldBuiltinMethods folds charAt on a string literal',
    input: `var x = "abc".charAt(1);`,
  },
  charCodeAt: {
    name: 'foldBuiltinMethods folds charCodeAt on a string literal',
    input: `var x = "A".charCodeAt(0);`,
  },
  sliceStr: {
    name: 'foldBuiltinMethods folds slice on a string literal',
    input: `var x = "hello".slice(1, 3);`,
  },
  substringStr: {
    name: 'foldBuiltinMethods folds substring on a string literal',
    input: `var x = "hello".substring(0, 2);`,
  },
  trimStr: {
    name: 'foldBuiltinMethods folds trim on a string literal with surrounding whitespace',
    input: `var x = "  hello  ".trim();`,
  },
  repeatStr: {
    name: 'foldBuiltinMethods folds repeat on a string literal',
    input: `var x = "ab".repeat(3);`,
  },
  concatStr: {
    name: 'foldBuiltinMethods folds concat on a string literal with constant args',
    input: `var x = "abc".concat("def");`,
  },
  includesStr: {
    name: 'foldBuiltinMethods folds includes on a string literal',
    input: `var x = "abc".includes("b");`,
  },
  startsWithStr: {
    name: 'foldBuiltinMethods folds startsWith on a string literal',
    input: `var x = "abc".startsWith("a");`,
  },
  endsWithStr: {
    name: 'foldBuiltinMethods folds endsWith on a string literal',
    input: `var x = "abc".endsWith("c");`,
  },
  padStartStr: {
    name: 'foldBuiltinMethods folds padStart on a string literal',
    input: `var x = "5".padStart(3, "0");`,
  },
  indexOfStr: {
    name: 'foldBuiltinMethods folds indexOf on a string literal',
    input: `var x = "abc".indexOf("b");`,
  },
  atStr: {
    name: 'foldBuiltinMethods folds at on a string literal',
    input: `var x = "abc".at(1);`,
  },
  stringMethodOnUnknown: {
    name: 'foldBuiltinMethods leaves a string method call alone on an unknown receiver',
    input: `var x = y.toUpperCase();`,
  },
  stringMethodOnConstReceiver: {
    name: 'foldBuiltinMethods folds a string method when the receiver is a const-bound string',
    input: `const s = "hello";
var x = s.toUpperCase();`,
  },
  stringConcatTooLong: {
    name: 'foldBuiltinMethods leaves a string method alone when the result would exceed the literal length cap',
    input: `var x = "ab".repeat(10000);`,
  },

  numToString: {
    name: 'foldBuiltinMethods folds toString on a numeric literal',
    input: `var x = (5).toString();`,
  },
  numToStringRadix: {
    name: 'foldBuiltinMethods folds toString with a radix on a numeric literal',
    input: `var x = (255).toString(16);`,
  },
  toFixedNum: {
    name: 'foldBuiltinMethods folds toFixed on a numeric literal',
    input: `var x = (3.14).toFixed(1);`,
  },
  toExponentialNum: {
    name: 'foldBuiltinMethods folds toExponential on a numeric literal',
    input: `var x = (123).toExponential(2);`,
  },
  toPrecisionNum: {
    name: 'foldBuiltinMethods folds toPrecision on a numeric literal',
    input: `var x = (123.456).toPrecision(4);`,
  },

  boolToString: {
    name: 'foldBuiltinMethods folds toString on a boolean literal',
    input: `var x = true.toString();`,
  },

  stringLength: {
    name: 'foldBuiltinMethods folds .length on a string literal',
    input: `var x = "hello".length;`,
  },
  stringLengthConst: {
    name: 'foldBuiltinMethods folds .length on a const-bound string',
    input: `const s = "hi";
var x = s.length;`,
  },
  numberLengthIgnored: {
    name: 'foldBuiltinMethods leaves .length on a number literal alone',
    input: `var x = (5).length;`,
  },
  unrelatedLength: {
    name: 'foldBuiltinMethods leaves .length on an unknown receiver alone',
    input: `var x = y.length;`,
  },
})

test(cases.mathPi.name, () => {
  expect(run(cases.mathPi.input, foldBuiltinMethods)).toContain(`var x = ${Math.PI}`)
})

test(cases.mathE.name, () => {
  expect(run(cases.mathE.input, foldBuiltinMethods)).toContain(`var x = ${Math.E}`)
})

test(cases.mathSqrt2.name, () => {
  expect(run(cases.mathSqrt2.input, foldBuiltinMethods)).toContain(`var x = ${Math.SQRT2}`)
})

test(cases.mathConstantShadowed.name, () => {
  expect(run(cases.mathConstantShadowed.input, foldBuiltinMethods)).toContain('Math.PI')
})

test(cases.mathUnknownProperty.name, () => {
  expect(run(cases.mathUnknownProperty.input, foldBuiltinMethods)).toContain('Math.NOT_A_THING')
})

test(cases.mathPowSyntactic.name, () => {
  const out = run(cases.mathPowSyntactic.input, foldBuiltinMethods)
  expect(out).toContain('a ** 2')
  expect(out).not.toContain('Math.pow')
})

test(cases.mathPowUnknownOperands.name, () => {
  const out = run(cases.mathPowUnknownOperands.input, foldBuiltinMethods)
  expect(out).toContain('Math.pow(a, b)')
  expect(out).not.toContain('**')
})

test(cases.mathPowConstants.name, () => {
  const out = run(cases.mathPowConstants.input, foldBuiltinMethods)
  expect(out).toContain('2 ** 3')
  expect(out).not.toContain('Math.pow')
})

test(cases.mathPowSideEffectful.name, () => {
  const out = run(cases.mathPowSideEffectful.input, foldBuiltinMethods)
  expect(out).toContain('getX() ** +getY()')
})

test(cases.mathPowShadowed.name, () => {
  expect(run(cases.mathPowShadowed.input, foldBuiltinMethods)).toContain('Math.pow(2, 3)')
})

test(cases.mathPowWrongArity.name, () => {
  const out = run(cases.mathPowWrongArity.input, foldBuiltinMethods)
  expect(out).toContain('Math.pow(2)')
  expect(out).toContain('Math.pow(2, 3, 4)')
})

test(cases.mathAbs.name, () => {
  expect(run(cases.mathAbs.input, foldBuiltinMethods)).toContain('var x = 5')
})

test(cases.mathFloor.name, () => {
  expect(run(cases.mathFloor.input, foldBuiltinMethods)).toContain('var x = 3')
})

test(cases.mathCeil.name, () => {
  expect(run(cases.mathCeil.input, foldBuiltinMethods)).toContain('var x = 4')
})

test(cases.mathRound.name, () => {
  expect(run(cases.mathRound.input, foldBuiltinMethods)).toContain('var x = 4')
})

test(cases.mathSqrt.name, () => {
  expect(run(cases.mathSqrt.input, foldBuiltinMethods)).toContain('var x = 4')
})

test(cases.mathMax.name, () => {
  expect(run(cases.mathMax.input, foldBuiltinMethods)).toContain('var x = 3')
})

test(cases.mathMin.name, () => {
  expect(run(cases.mathMin.input, foldBuiltinMethods)).toContain('var x = 1')
})

test(cases.mathHypot.name, () => {
  expect(run(cases.mathHypot.input, foldBuiltinMethods)).toContain('var x = 5')
})

test(cases.mathSign.name, () => {
  expect(run(cases.mathSign.input, foldBuiltinMethods)).toContain('var x = -1')
})

test(cases.mathCbrt.name, () => {
  expect(run(cases.mathCbrt.input, foldBuiltinMethods)).toContain('var x = 3')
})

test(cases.mathTrunc.name, () => {
  expect(run(cases.mathTrunc.input, foldBuiltinMethods)).toContain('var x = 3')
})

test(cases.mathClz32.name, () => {
  expect(run(cases.mathClz32.input, foldBuiltinMethods)).toContain('var x = 31')
})

test(cases.mathImul.name, () => {
  expect(run(cases.mathImul.input, foldBuiltinMethods)).toContain('var x = 12')
})

test(cases.mathLog2.name, () => {
  expect(run(cases.mathLog2.input, foldBuiltinMethods)).toContain('var x = 3')
})

test(cases.mathAbsUnknown.name, () => {
  expect(run(cases.mathAbsUnknown.input, foldBuiltinMethods)).toContain('Math.abs(y)')
})

test(cases.mathSqrtNegative.name, () => {
  expect(run(cases.mathSqrtNegative.input, foldBuiltinMethods)).toContain('Math.sqrt(-1)')
})

test(cases.mathLogZero.name, () => {
  expect(run(cases.mathLogZero.input, foldBuiltinMethods)).toContain('Math.log(0)')
})

test(cases.numberMaxSafeInt.name, () => {
  expect(run(cases.numberMaxSafeInt.input, foldBuiltinMethods)).toContain(
    `var x = ${Number.MAX_SAFE_INTEGER}`,
  )
})

test(cases.numberEpsilon.name, () => {
  expect(run(cases.numberEpsilon.input, foldBuiltinMethods)).toContain(`var x = ${Number.EPSILON}`)
})

test(cases.numberIsNaN.name, () => {
  expect(run(cases.numberIsNaN.input, foldBuiltinMethods)).toContain('var x = false')
})

test(cases.numberIsFinite.name, () => {
  expect(run(cases.numberIsFinite.input, foldBuiltinMethods)).toContain('var x = true')
})

test(cases.numberIsInteger.name, () => {
  expect(run(cases.numberIsInteger.input, foldBuiltinMethods)).toContain('var x = true')
})

test(cases.numberIsSafeInteger.name, () => {
  expect(run(cases.numberIsSafeInteger.input, foldBuiltinMethods)).toContain('var x = true')
})

test(cases.numberParseInt.name, () => {
  expect(run(cases.numberParseInt.input, foldBuiltinMethods)).toContain('var x = 42')
})

test(cases.numberParseFloat.name, () => {
  expect(run(cases.numberParseFloat.input, foldBuiltinMethods)).toContain('var x = 3.14')
})

test(cases.numberCtorString.name, () => {
  expect(run(cases.numberCtorString.input, foldBuiltinMethods)).toContain('var x = 5')
})

test(cases.numberCtorBool.name, () => {
  expect(run(cases.numberCtorBool.input, foldBuiltinMethods)).toContain('var x = 1')
})

test(cases.numberCtorNoArg.name, () => {
  expect(run(cases.numberCtorNoArg.input, foldBuiltinMethods)).toContain('var x = 0')
})

test(cases.numberCtorUnknown.name, () => {
  expect(run(cases.numberCtorUnknown.input, foldBuiltinMethods)).toContain('Number(y)')
})

test(cases.stringFromCharCode.name, () => {
  expect(run(cases.stringFromCharCode.input, foldBuiltinMethods)).toContain('var x = "Hi"')
})

test(cases.stringFromCharCodeOne.name, () => {
  expect(run(cases.stringFromCharCodeOne.input, foldBuiltinMethods)).toContain('var x = "A"')
})

test(cases.stringFromCodePoint.name, () => {
  expect(run(cases.stringFromCodePoint.input, foldBuiltinMethods)).toContain('var x = "AB"')
})

test(cases.stringCtor.name, () => {
  expect(run(cases.stringCtor.input, foldBuiltinMethods)).toContain('var x = "5"')
})

test(cases.stringCtorBool.name, () => {
  expect(run(cases.stringCtorBool.input, foldBuiltinMethods)).toContain('var x = "true"')
})

test(cases.stringCtorNull.name, () => {
  expect(run(cases.stringCtorNull.input, foldBuiltinMethods)).toContain('var x = "null"')
})

test(cases.stringCtorNoArg.name, () => {
  expect(run(cases.stringCtorNoArg.input, foldBuiltinMethods)).toContain('var x = ""')
})

test(cases.booleanCtorIdent.name, () => {
  const out = run(cases.booleanCtorIdent.input, foldBuiltinMethods)
  expect(out).toContain('!!y')
  expect(out).not.toContain('Boolean(')
})

test(cases.booleanCtorTruthy.name, () => {
  expect(run(cases.booleanCtorTruthy.input, foldBuiltinMethods)).toContain('!!1')
})

test(cases.booleanCtorNoArg.name, () => {
  expect(run(cases.booleanCtorNoArg.input, foldBuiltinMethods)).toContain('var x = false')
})

test(cases.booleanCtorShadowed.name, () => {
  expect(run(cases.booleanCtorShadowed.input, foldBuiltinMethods)).toContain('Boolean(y)')
})

test(cases.arrayOf.name, () => {
  const out = run(cases.arrayOf.input, foldBuiltinMethods)
  expect(out).toContain('[1, 2, 3]')
  expect(out).not.toContain('Array.of')
})

test(cases.arrayOfSpread.name, () => {
  const out = run(cases.arrayOfSpread.input, foldBuiltinMethods)
  expect(out).toContain('[...args]')
  expect(out).not.toContain('Array.of')
})

test(cases.arrayOfEmpty.name, () => {
  expect(run(cases.arrayOfEmpty.input, foldBuiltinMethods)).toContain('var x = []')
})

test(cases.arrayIsArrayScalar.name, () => {
  expect(run(cases.arrayIsArrayScalar.input, foldBuiltinMethods)).toContain('var x = false')
})

test(cases.arrayIsArrayUnknown.name, () => {
  expect(run(cases.arrayIsArrayUnknown.input, foldBuiltinMethods)).toContain('Array.isArray(y)')
})

test(cases.parseIntDecimal.name, () => {
  expect(run(cases.parseIntDecimal.input, foldBuiltinMethods)).toContain('var x = 42')
})

test(cases.parseIntRadix.name, () => {
  expect(run(cases.parseIntRadix.input, foldBuiltinMethods)).toContain('var x = 31')
})

test(cases.parseFloatGlobal.name, () => {
  expect(run(cases.parseFloatGlobal.input, foldBuiltinMethods)).toContain('var x = 3.14')
})

test(cases.isNaNGlobal.name, () => {
  expect(run(cases.isNaNGlobal.input, foldBuiltinMethods)).toContain('var x = false')
})

test(cases.isFiniteGlobal.name, () => {
  expect(run(cases.isFiniteGlobal.input, foldBuiltinMethods)).toContain('var x = true')
})

test(cases.atobGlobal.name, () => {
  expect(run(cases.atobGlobal.input, foldBuiltinMethods)).toContain('var x = "Hi"')
})

test(cases.btoaGlobal.name, () => {
  expect(run(cases.btoaGlobal.input, foldBuiltinMethods)).toContain('var x = "SGk="')
})

test(cases.encodeURIGlobal.name, () => {
  expect(run(cases.encodeURIGlobal.input, foldBuiltinMethods)).toContain('var x = "a%20b"')
})

test(cases.encodeURIComponentGlobal.name, () => {
  expect(run(cases.encodeURIComponentGlobal.input, foldBuiltinMethods)).toContain(
    'var x = "a%20b%26c"',
  )
})

test(cases.decodeURIGlobal.name, () => {
  expect(run(cases.decodeURIGlobal.input, foldBuiltinMethods)).toContain('var x = "a b"')
})

test(cases.parseIntShadowed.name, () => {
  expect(run(cases.parseIntShadowed.input, foldBuiltinMethods)).toContain('parseInt("5")')
})

test(cases.globalUnknownArg.name, () => {
  expect(run(cases.globalUnknownArg.input, foldBuiltinMethods)).toContain('parseInt(s)')
})

test(cases.toUpperCase.name, () => {
  expect(run(cases.toUpperCase.input, foldBuiltinMethods)).toContain('var x = "ABC"')
})

test(cases.toLowerCase.name, () => {
  expect(run(cases.toLowerCase.input, foldBuiltinMethods)).toContain('var x = "abc"')
})

test(cases.charAt.name, () => {
  expect(run(cases.charAt.input, foldBuiltinMethods)).toContain('var x = "b"')
})

test(cases.charCodeAt.name, () => {
  expect(run(cases.charCodeAt.input, foldBuiltinMethods)).toContain('var x = 65')
})

test(cases.sliceStr.name, () => {
  expect(run(cases.sliceStr.input, foldBuiltinMethods)).toContain('var x = "el"')
})

test(cases.substringStr.name, () => {
  expect(run(cases.substringStr.input, foldBuiltinMethods)).toContain('var x = "he"')
})

test(cases.trimStr.name, () => {
  expect(run(cases.trimStr.input, foldBuiltinMethods)).toContain('var x = "hello"')
})

test(cases.repeatStr.name, () => {
  expect(run(cases.repeatStr.input, foldBuiltinMethods)).toContain('var x = "ababab"')
})

test(cases.concatStr.name, () => {
  expect(run(cases.concatStr.input, foldBuiltinMethods)).toContain('var x = "abcdef"')
})

test(cases.includesStr.name, () => {
  expect(run(cases.includesStr.input, foldBuiltinMethods)).toContain('var x = true')
})

test(cases.startsWithStr.name, () => {
  expect(run(cases.startsWithStr.input, foldBuiltinMethods)).toContain('var x = true')
})

test(cases.endsWithStr.name, () => {
  expect(run(cases.endsWithStr.input, foldBuiltinMethods)).toContain('var x = true')
})

test(cases.padStartStr.name, () => {
  expect(run(cases.padStartStr.input, foldBuiltinMethods)).toContain('var x = "005"')
})

test(cases.indexOfStr.name, () => {
  expect(run(cases.indexOfStr.input, foldBuiltinMethods)).toContain('var x = 1')
})

test(cases.atStr.name, () => {
  expect(run(cases.atStr.input, foldBuiltinMethods)).toContain('var x = "b"')
})

test(cases.stringMethodOnUnknown.name, () => {
  expect(run(cases.stringMethodOnUnknown.input, foldBuiltinMethods)).toContain('y.toUpperCase()')
})

test(cases.stringMethodOnConstReceiver.name, () => {
  expect(run(cases.stringMethodOnConstReceiver.input, foldBuiltinMethods)).toContain(
    'var x = "HELLO"',
  )
})

test(cases.stringConcatTooLong.name, () => {
  expect(run(cases.stringConcatTooLong.input, foldBuiltinMethods)).toContain('"ab".repeat(10000)')
})

test(cases.numToString.name, () => {
  expect(run(cases.numToString.input, foldBuiltinMethods)).toContain('var x = "5"')
})

test(cases.numToStringRadix.name, () => {
  expect(run(cases.numToStringRadix.input, foldBuiltinMethods)).toContain('var x = "ff"')
})

test(cases.toFixedNum.name, () => {
  expect(run(cases.toFixedNum.input, foldBuiltinMethods)).toContain('var x = "3.1"')
})

test(cases.toExponentialNum.name, () => {
  expect(run(cases.toExponentialNum.input, foldBuiltinMethods)).toContain('1.23e+2')
})

test(cases.toPrecisionNum.name, () => {
  expect(run(cases.toPrecisionNum.input, foldBuiltinMethods)).toContain('123.5')
})

test(cases.boolToString.name, () => {
  expect(run(cases.boolToString.input, foldBuiltinMethods)).toContain('var x = "true"')
})

test(cases.stringLength.name, () => {
  expect(run(cases.stringLength.input, foldBuiltinMethods)).toContain('var x = 5')
})

test(cases.stringLengthConst.name, () => {
  expect(run(cases.stringLengthConst.input, foldBuiltinMethods)).toContain('var x = 2')
})

test(cases.numberLengthIgnored.name, () => {
  // Babel prints a space before member access on a numeric literal.
  const out = run(cases.numberLengthIgnored.input, foldBuiltinMethods)
  expect(out).toMatch(/\.length/)
  expect(out).not.toMatch(/var x = (undefined|0|1);/)
})

test(cases.unrelatedLength.name, () => {
  expect(run(cases.unrelatedLength.input, foldBuiltinMethods)).toContain('y.length')
})

// Compare logs and thrown classes before and after folding.

function expectFoldPreservesBehavior(src: string): string {
  const out = run(src, foldBuiltinMethods)
  expect(trace(out)).toEqual(trace(src))
  return out
}

test('foldBuiltinMethods does not fold String() of a regexp, function, or class', () => {
  expect(run('var x = String(/abc/);', foldBuiltinMethods)).not.toContain('[object Object]')
  expectFoldPreservesBehavior('log(String(/abc/));')
  expectFoldPreservesBehavior('function f(){} log(String(f).length > 0);')
  expectFoldPreservesBehavior('class C{} log(String(C).length > 0);')
})

test('foldBuiltinMethods does not fold string methods that take a regexp argument', () => {
  expectFoldPreservesBehavior('log("x".concat(/y/));')
  expectFoldPreservesBehavior('log(encodeURIComponent(/re/));')
  expectFoldPreservesBehavior('log("5".padStart(3, /0/));')
  expectFoldPreservesBehavior(
    'try { log("x".includes(/y/)); } catch (error) { log(error.constructor.name); }',
  )
})

test('foldBuiltinMethods does not rewrite Math.pow that could receive BigInt operands', () => {
  const out = run('var x = Math.pow(2n, 3n);', foldBuiltinMethods)
  expect(out).toContain('Math.pow')
  expect(out).not.toContain('**')
  expectFoldPreservesBehavior(
    'try { log(Math.pow(2n, 3n)); } catch (error) { log(error.constructor.name); }',
  )
  expectFoldPreservesBehavior(
    'var a = 2n, b = 3n; try { log(Math.pow(a, b)); } catch (error) { log(error.constructor.name); }',
  )
  expectFoldPreservesBehavior(
    'try { log(Math.pow({valueOf(){return 2n}}, {valueOf(){return 3n}})); } catch (error) { log(error.constructor.name); }',
  )
})

test('foldBuiltinMethods materializes an undefined result as unshadowable void 0', () => {
  const out = run('function f(undefined) { return "ab".at(9); }', foldBuiltinMethods)
  expect(out).toContain('void 0')
  expectFoldPreservesBehavior('function f(undefined) { return "ab".at(9); } log(f(42));')
})

test('foldBuiltinMethods does not fold anything inside a with block', () => {
  expectFoldPreservesBehavior(
    'function f(o) { with (o) { return String(1); } } log(f({ String: function () { return "X"; } }));',
  )
  expectFoldPreservesBehavior(
    'function f(o) { with (o) { return Math.PI; } } log(f({ Math: { PI: 42 } }));',
  )
  expectFoldPreservesBehavior(
    'function f(o) { var s = "abc"; with (o) { return s.toUpperCase(); } } log(f({ s: "zzz" }));',
  )
})

test('foldBuiltinMethods does not fold a method whose intrinsic the program patches', () => {
  expectFoldPreservesBehavior(
    'String.prototype.toUpperCase = function () { return "PATCHED"; }; log("abc".toUpperCase());',
  )
  expectFoldPreservesBehavior('Math.floor = function () { return 999; }; log(Math.floor(3.7));')
  expectFoldPreservesBehavior(
    'Object.defineProperty(Number, "MAX_SAFE_INTEGER", { value: 1 }); log(Number.MAX_SAFE_INTEGER);',
  )
})

test('foldBuiltinMethods does not fold a member in an assignment or binding target', () => {
  // A03-01/A03-02: A destructuring target must remain an assignable member.
  const arrayTarget = expectFoldPreservesBehavior('["abc".length] = [1]; log(1);')
  expect(arrayTarget).toContain('"abc".length')
  expectFoldPreservesBehavior('({ a: { b: "abc".length } } = { a: { b: 1 } }); log(1);')
  expectFoldPreservesBehavior('for (["abc".length] in { a: 1 }) {} log(1);')
  expectFoldPreservesBehavior('({ a: "abc".length = 2 } = {}); log(1);')
  expectFoldPreservesBehavior('[..."abcd".length] = []; log(1);')
})

test('foldBuiltinMethods still folds a genuine value read in object-expression position', () => {
  // The write-target guard must still allow value reads.
  expect(run('var o = { b: "abc".length };', foldBuiltinMethods)).toContain('b: 3')
})

test('foldBuiltinMethods does not fold a string call into a "use strict" directive', () => {
  // A03-03: A folded leading string can create a strict directive.
  const out = run(
    'function f() { "use strict".trim(); return this; } log(typeof f.call(7));',
    foldBuiltinMethods,
  )
  expect(out).not.toMatch(/\{\s*"use strict";/)
  expectFoldPreservesBehavior(
    'function f() { "use strict".trim(); return this; } log(typeof f.call(7));',
  )
  expectFoldPreservesBehavior('function f(a, a) { "use strict".trim(); log(a); } f(1, 2);')
  // Every string-valued fold can create the same directive.
  expectFoldPreservesBehavior(
    'function f() { String("use strict"); return this; } log(typeof f.call(7));',
  )
  expectFoldPreservesBehavior(
    'function f() { "use ".concat("strict"); return this; } log(typeof f.call(7));',
  )
  expectFoldPreservesBehavior(
    'function f() { "xuse strict".slice(1); return this; } log(typeof f.call(7));',
  )
  expectFoldPreservesBehavior(
    'function f() { String.fromCharCode(117, 115, 101, 32, 115, 116, 114, 105, 99, 116); return this; } log(typeof f.call(7));',
  )
})

test('foldBuiltinMethods resolves a shadowed `undefined` as the binding, not the value', () => {
  expectFoldPreservesBehavior('function f(undefined) { log(String(undefined)); } f("hi");')
  expectFoldPreservesBehavior(
    'function f(undefined) { log("xundefinedy".indexOf(undefined)); } f("x");',
  )
  expectFoldPreservesBehavior('var undefined = "hi"; log(String(undefined));')
})

test('foldBuiltinMethods does not fold a read that has not executed yet', () => {
  // A03-05/06/07: TDZ, hoisted calls, and skipped initializers defeat document order.
  expectFoldPreservesBehavior('g(); let v = "abc"; function g() { log(String(v)); }')
  expectFoldPreservesBehavior('g(); let v = "abcd"; function g() { log(v.length); }')
  expectFoldPreservesBehavior('h(); var v = "abc"; function h() { log(String(v)); }')
  expectFoldPreservesBehavior('foo: { break foo; var s = "ab"; } log(String(s));')
})

test('foldBuiltinMethods bails inside a scope with a direct eval', () => {
  // A03-08: Sloppy direct eval can shadow an intrinsic root.
  const out = run(
    'eval("var Math = { floor: function(){ return 42 } };"); log(Math.floor(1.5));',
    foldBuiltinMethods,
  )
  expect(out).toContain('Math.floor(1.5)')
  expectFoldPreservesBehavior(
    'eval("var Math = { floor: function(){ return 42 } };"); log(Math.floor(1.5));',
  )
})

test('foldBuiltinMethods does not fold an intrinsic the program patches indirectly', () => {
  // A03-09/10/11/12: Aliases and bulk writes can mutate host intrinsics.
  const aliased = expectFoldPreservesBehavior(
    'var m = Math; m.floor = function () { return 42; }; log(Math.floor(1.5));',
  )
  expect(aliased).toContain('Math.floor(1.5)')
  expectFoldPreservesBehavior(
    'Object.assign(String.prototype, { toUpperCase: function () { return "P"; } }); log("abc".toUpperCase());',
  )
  expectFoldPreservesBehavior(
    'Object.assign(Math, { floor: function () { return 42; } }); log(Math.floor(1.5));',
  )
  expectFoldPreservesBehavior(
    'Function("Math.round = function(){ return 42 }")(); log(Math.round(1.5));',
  )
  expectFoldPreservesBehavior(
    'Reflect.set(Math, "floor", function () { return 42; }); log(Math.floor(1.5));',
  )
  expectFoldPreservesBehavior(
    'globalThis.Boolean = function () { return "patched"; }; log(Boolean(0));',
  )
})
