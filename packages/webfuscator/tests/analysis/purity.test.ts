import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import { expect, test } from 'vitest'

import { isPure, isSideEffectFree } from '../../src/analysis/purity'

// Each snippet must contain exactly one expression statement for the test node.
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

// Some test identifiers sit inside declarations or parameter defaults.
function firstReference(code: string, name: string): NodePath<t.Identifier> {
  const ast = parse(code, { sourceType: 'unambiguous' })
  let ref: NodePath<t.Identifier> | undefined
  traverse(ast, {
    Identifier(path) {
      if (path.node.name === name && path.isReferencedIdentifier() && !ref) {
        ref = path as NodePath<t.Identifier>
      }
    },
  })
  if (!ref) {
    throw new Error(`could not locate a reference to ${name} in: ${code}`)
  }
  return ref
}

function certifiesFree(code: string): boolean {
  const path = soleExpression(code)
  return isSideEffectFree(path.node, path.scope, path)
}

function certifiesPure(code: string): boolean {
  const path = soleExpression(code)
  return isPure(path.node, path.scope, path)
}

// Without scope, no identifier read can be proved safe.
const PURE_NO_SCOPE = [
  '5',
  '("s")',
  'true',
  'null',
  '5n',
  '/re/',
  'this',
  '`plain`',
  '`a${1}${"b"}c`',
  '1 + 2',
  '1 < 2',
  '5n * 2n',
  '!true',
  'typeof "s"',
  'void 0',
  '(1, 2, 3)',
  'true ? 1 : 2',
]

// Resolved and initialized bindings make their reads provable.
const PURE_WITH_SCOPE = [
  'var x = 1; x;',
  'var x = 1, y = 2; x && y;',
  'var x = 1, y = 2; x || y;',
  'var x = 1, y = 2, z = 3; x ? y : z;',
  'var x = 1, y = 2, z = 3; (x, y, z);',
  'var x = 1; !x;',
  'var x = 1; typeof x;',
  'var x = 1; void x;',
  'var x = 1, y = 2; x === y;',
  'var x = 1, y = 2; x !== y;',
  'function f(a, b) { a === b; }',
]

// Refusals cover unresolved names, `with`, TDZ, and user-defined coercion.
const IMPURE_WITH_SCOPE = [
  'unresolved;',
  'var x = 5; var o = { get x() { return 1; } }; with (o) { x; }',
  'tdz; let tdz = 1;',
  'var x = 1; +x;',
  'var x = 1; -x;',
  'var x = 1; ~x;',
  'var x = 1; x - 0;',
  'var x = 1; x + 1;',
  'var x = 1; `${x}`;',
  'var x = 1, y = 2; x < y;',
  'var x = 1, y = 2; x == y;',
  'var x = 1, y = 2; x * y;',
  'f();',
  'a.b;',
  'a[b];',
  'x = 1;',
  'x++;',
  'new F();',
  'delete a.b;',
  'a in b;',
  'a instanceof b;',
  'g() ? 1 : 2;',
  '(a, f());',
]

test('isPure certifies coercion-free, identifier-free expressions with no scope', () => {
  for (const code of PURE_NO_SCOPE) {
    expect(isPure(soleExpression(code).node)).toBe(true)
  }
})

test('isPure refuses a bare identifier when no scope is supplied', () => {
  // No scope can prove resolution or TDZ state.
  expect(isPure(soleExpression('x;').node)).toBe(false)
  expect(isPure(soleExpression('x && y;').node)).toBe(false)
  expect(isPure(soleExpression('typeof x;').node)).toBe(false)
})

test('isPure certifies a provably-initialized identifier read with a scope', () => {
  for (const code of PURE_WITH_SCOPE) {
    expect(certifiesPure(code)).toBe(true)
  }
})

test('isPure refuses unresolved reads, with-shadowing, TDZ, and coercion', () => {
  for (const code of IMPURE_WITH_SCOPE) {
    expect(certifiesPure(code)).toBe(false)
  }
})

test('isPure still certifies the global `undefined` with no scope', () => {
  expect(isPure(soleExpression('undefined;').node)).toBe(true)
})

const FREE = [
  '99',
  '("str")',
  'undefined',
  '(function () {})',
  '(() => {})',
  '(class { p = 1; })',
  '(class extends null {})',
  '(class extends (function () {}) {})',
  '[1, 2, 3]',
  '({ a: 1, b: 2 })',
  '({ get p() { return sideEffect(); } })',
  'void 0',
  '!true',
  '1 + 2',
  '5n + 2n',
  '5n * 2n',
  '1 && 0',
  '1 ? 2 : 3',
  '(1, 2, 3)',
  '`tmpl ${1}`',
]

const NOT_FREE = [
  'unresolvedGlobal',
  'obj.prop',
  'arr[0]',
  'compute()',
  'new Widget()',
  'count++',
  'total = 1',
  '[a, ...rest]',
  '[compute()]',
  '({ ...spread })',
  '({ [compute()]: 1 })',
  '({ p: compute() })',
  '(class { static s = compute(); })',
  '(class { static #s = compute(); })',
  '(class { static { let q = 1; } })',
  '(class extends 5 {})',
  '(class extends undefined {})',
  '(class extends (function* () {}) {})',
  'delete obj.prop',
  'typeof compute()',
  'void compute()',
  '!compute()',
  'a in b',
  'a instanceof b',
  'compute() + 1',
  'compute() || 1',
  'compute() ? 1 : 2',
  '(compute(), 1)',
  '1n / 0n',
  '1n % 0n',
  '2n ** 2n',
  '1n >>> 2n',
  '1n + 1',
  '1n < 1',
]

test('isSideEffectFree certifies expressions whose evaluation is observably inert', () => {
  for (const code of FREE) {
    expect(certifiesFree(code)).toBe(true)
  }
})

test('isSideEffectFree refuses anything that can call, throw, or write', () => {
  for (const code of NOT_FREE) {
    expect(certifiesFree(code)).toBe(false)
  }
})

test('isSideEffectFree certifies param, function-declaration, and module bindings', () => {
  expect(certifiesFree('function f(param) { param; }')).toBe(true)
  expect(certifiesFree('function g() {} g;')).toBe(true)
  expect(certifiesFree('import { z } from "m"; z;')).toBe(true)
})

test('isSideEffectFree certifies an identifier read after its declaration', () => {
  expect(certifiesFree('let ok = 5; ok;')).toBe(true)
})

test('isSideEffectFree refuses an identifier read before its declaration (TDZ)', () => {
  expect(certifiesFree('tdz; let tdz = 5;')).toBe(false)
})

test('isSideEffectFree refuses a bound identifier when no scope is supplied', () => {
  expect(isSideEffectFree(soleExpression('anything;').node)).toBe(false)
})

test('isSideEffectFree still certifies the `undefined` identifier without a scope', () => {
  expect(isSideEffectFree(soleExpression('undefined;').node)).toBe(true)
})

test('isSideEffectFree refuses a parameter read inside an earlier parameter default (param TDZ)', () => {
  // `b` remains in TDZ while the earlier default runs.
  const ref = firstReference('function f(a = b, b = 2) { a; }', 'b')
  expect(isSideEffectFree(ref.node, ref.scope, ref)).toBe(false)
})

test('isSideEffectFree certifies a parameter read of an earlier parameter', () => {
  const ref = firstReference('function f(a, b = a) { b; }', 'a')
  expect(isSideEffectFree(ref.node, ref.scope, ref)).toBe(true)
})

test('isSideEffectFree refuses a read inside `with` (a with-object getter)', () => {
  const ref = firstReference('var k = 5; var o = {}; with (o) { k; }', 'k')
  expect(isSideEffectFree(ref.node, ref.scope, ref)).toBe(false)
  expect(isPure(ref.node, ref.scope, ref)).toBe(false)
})

test('isSideEffectFree refuses an unbound read inside `with`, including `undefined`', () => {
  // A `with` accessor can shadow even `undefined`.
  const undefinedRead = firstReference('var o = {}; with (o) { undefined; }', 'undefined')
  expect(isSideEffectFree(undefinedRead.node, undefinedRead.scope, undefinedRead)).toBe(false)
  expect(isPure(undefinedRead.node, undefinedRead.scope, undefinedRead)).toBe(false)
  const globalRead = firstReference('var o = {}; with (o) { unbound; }', 'unbound')
  expect(isSideEffectFree(globalRead.node, globalRead.scope, globalRead)).toBe(false)
  expect(isPure(globalRead.node, globalRead.scope, globalRead)).toBe(false)
})

test('isSideEffectFree refuses a shadowed `undefined` read still in its TDZ', () => {
  // This read precedes the local `let undefined`.
  const ref = firstReference('function f() { undefined; let undefined = 5; }', 'undefined')
  expect(isSideEffectFree(ref.node, ref.scope, ref)).toBe(false)
})
