import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { expect, test } from 'vitest'

import { evaluateConstant } from 'src/analysis/constant'
import type { Evaluation } from 'src/analysis/constant'

function soleExpression(code: string): NodePath<t.Expression> {
  const ast = parse(code, { sourceType: 'unambiguous' })
  const found: NodePath<t.Expression>[] = []
  traverse(ast, {
    ExpressionStatement(path) {
      found.push(path.get('expression') as NodePath<t.Expression>)
    },
  })
  if (found.length !== 1) {
    throw new Error(`expected exactly one expression statement in: ${code} (got ${found.length})`)
  }
  return found[0]!
}

function evalConst(code: string): Evaluation {
  const path = soleExpression(code)
  return evaluateConstant(path.node, path.scope, path)
}

// A `record` call lets fold targets keep surrounding scope and ancestry.
function evalRecordArg(code: string): Evaluation {
  const ast = parse(code, { sourceType: 'unambiguous' })
  let found: NodePath<t.Expression> | undefined
  traverse(ast, {
    CallExpression(path) {
      if (found || !t.isIdentifier(path.node.callee, { name: 'record' })) {
        return
      }
      found = path.get('arguments')[0] as NodePath<t.Expression>
    },
  })
  if (!found) {
    throw new Error(`no record(...) call in: ${code}`)
  }
  return evaluateConstant(found.node, found.scope, found)
}

const KNOWN: [string, unknown][] = [
  ['5', 5],
  ['("hi")', 'hi'],
  ['true', true],
  ['false', false],
  ['null', null],
  ['5n', 5n],
  ['`plain`', 'plain'],
  ['undefined', undefined],
  ['!0', true],
  ['!1', false],
  ['+"3"', 3],
  ['-4', -4],
  ['~0', -1],
  ['typeof "x"', 'string'],
  ['void 0', undefined],
  ['1 + 2', 3],
  ['10 - 3', 7],
  ['4 * 5', 20],
  ['9 / 2', 4.5],
  ['9 % 4', 1],
  ['2 ** 10', 1024],
  ['6 & 3', 2],
  ['6 | 1', 7],
  ['5 ^ 1', 4],
  ['1 << 4', 16],
  ['256 >> 2', 64],
  ['-1 >>> 28', 15],
  ['1 < 2', true],
  ['2 <= 2', true],
  ['3 > 5', false],
  ['5 >= 5', true],
  ['1 === 1', true],
  ['1 !== 2', true],
  ['1 == "1"', true],
  ['1 != "1"', false],
  ['null == undefined', true],
  ['true && 3', 3],
  ['0 && 3', 0],
  ['0 || 7', 7],
  ['2 || 7', 2],
  ['null ?? 9', 9],
  ['3 ?? 9', 3],
  ['1 ? "a" : "b"', 'a'],
  ['0 ? "a" : "b"', 'b'],
]

const UNKNOWN = [
  'x',
  'f()',
  'a.b',
  '`${x}`',
  '`${sideEffect()}`',
  '1 + x',
  'a in b',
  'a instanceof b',
  'delete a.b',
  'x++',
  'void f()',
  'typeof f()',
  '(1, 2)',
  'x && 1',
  'x || 1',
  'x ?? 1',
  'x ? 1 : 2',
]

test('evaluateConstant folds literals, unaries, binaries, logicals, and conditionals', () => {
  for (const [code, value] of KNOWN) {
    const result = evalConst(code)
    expect(result.known).toBe(true)
    expect((result as { known: true; value: unknown }).value).toEqual(value)
  }
})

test('evaluateConstant treats a regexp literal as a known opaque value', () => {
  expect(evalConst('/ab/;').known).toBe(true)
})

test('evaluateConstant refuses reads, calls, unknown operands, and sequences', () => {
  for (const code of UNKNOWN) {
    expect(evalConst(code).known).toBe(false)
  }
})

test('evaluateConstant resolves a const identifier to its initializer', () => {
  expect(evalConst('const a = 5; a;')).toEqual({ known: true, value: 5 })
})

test('evaluateConstant refuses a const whose initializer reads a later declaration (TDZ)', () => {
  expect(evalConst('const b = a; const a = 5; b;').known).toBe(false)
})

test('evaluateConstant treats a constant function or class binding as a known opaque value', () => {
  expect(evalConst('function g() {} g;').known).toBe(true)
  expect(evalConst('class C {} C;').known).toBe(true)
})

test('evaluateConstant refuses an unbound identifier, and refuses any identifier without scope', () => {
  expect(evalConst('unbound;').known).toBe(false)
  expect(evaluateConstant(soleExpression('unbound;').node).known).toBe(false)
})

test('evaluateConstant folds truthiness of an opaque value but refuses other operations', () => {
  expect(evalConst('!/ab/;')).toEqual({ known: true, value: false })
  expect(evalConst('function f(){} !f;')).toEqual({ known: true, value: false })
  expect(evalConst('class C{} !C;')).toEqual({ known: true, value: false })
  expect(evalConst('typeof /ab/;').known).toBe(false)
  expect(evalConst('function f(){} typeof f;').known).toBe(false)
  expect(evalConst('class C{} typeof C;').known).toBe(false)
  expect(evalConst('"" + /ab/;').known).toBe(false)
  expect(evalConst('function f(){} f === f;').known).toBe(false)
  expect(evalConst('/ab/ == "/ab/";').known).toBe(false)
})

test('evaluateConstant refuses unary + on a BigInt (it throws at runtime)', () => {
  expect(evalConst('+1n;').known).toBe(false)
  expect(evalConst('const x = 5n; +x;').known).toBe(false)
})

test('evaluateConstant refuses a var whose declarator sits in a conditional branch', () => {
  expect(evalConst('function f(c){ if (c) { var x = 5; } typeof x; }').known).toBe(false)
  expect(evalConst('function f(n){ while (n) { var x = 5; break; } typeof x; }').known).toBe(false)
  expect(evalConst('function f(o){ try { var x = 5; } finally {} typeof x; }').known).toBe(false)
})

test('evaluateConstant still folds a var on the straight-line path', () => {
  expect(evalConst('var x = 5; x;')).toEqual({ known: true, value: 5 })
  expect(evalConst('function f(){ for (var i=0;i<3;i++){ var c = 7; c; } }')).toEqual({
    known: true,
    value: 7,
  })
})

test('evaluateConstant refuses a read a nested function can run before its init (TDZ / hoisting)', () => {
  // The nested call runs before initialization despite later document order.
  expect(
    evalRecordArg('function o(){ h(); let q = 1; function h(){ record(q); } } o();').known,
  ).toBe(false)
  expect(
    evalRecordArg('function o(){ h(); var k = 5; function h(){ record(k); } } o();').known,
  ).toBe(false)
  expect(
    evalRecordArg('function o(){ h(); class C {} function h(){ record(C); } } o();').known,
  ).toBe(false)
})

test('evaluateConstant refuses any identifier read inside a `with` block', () => {
  // `with` can intercept the name outside Babel's scope table.
  expect(evalRecordArg('var obj = { k: 99 }; var k = 5; with (obj) { record(k); }').known).toBe(
    false,
  )
  // `with` can intercept global `undefined` too.
  expect(evalRecordArg('with (obj) { record(undefined); }').known).toBe(false)
})

test('evaluateConstant refuses an identifier read when a direct eval shares its scope', () => {
  expect(evalRecordArg('var k = 5; function f(){ eval("var k = 7"); record(k); } f();').known).toBe(
    false,
  )
})

test('evaluateConstant refuses the identifier `undefined` when a binding shadows it', () => {
  expect(evalRecordArg('function f(undefined){ record(undefined); } f(5);').known).toBe(false)
  expect(evalRecordArg('function f(){ var undefined = 5; record(undefined); } f();').known).toBe(
    false,
  )
  expect(evalRecordArg('try { throw 1; } catch (undefined) { record(undefined); }').known).toBe(
    false,
  )
})

test('evaluateConstant still folds the genuine global `undefined` and a same-scope read', () => {
  expect(evalRecordArg('record(undefined);')).toEqual({ known: true, value: undefined })
  expect(evalRecordArg('var k = 5; record(k);')).toEqual({ known: true, value: 5 })
})
