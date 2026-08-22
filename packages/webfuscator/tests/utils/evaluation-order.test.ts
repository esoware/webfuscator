import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import { expect, test } from 'vitest'

import { isConditionalGate, reorderableToStatement } from '../../src/utils/evaluation-order'

// Use the first referenced name as the inline test marker.
function refPath(code: string, name: string): NodePath {
  const ast = parse(code, { sourceType: 'unambiguous' })
  let found: NodePath | undefined
  traverse(ast, {
    Identifier(path) {
      if (path.node.name === name && path.isReferencedIdentifier() && !found) {
        found = path
      }
    },
  })
  if (!found) {
    throw new Error(`could not locate a reference to ${name} in: ${code}`)
  }
  return found
}

function gated(code: string, name: string): boolean {
  const path = refPath(code, name)
  return isConditionalGate(path.parentPath!, path)
}

function reorderable(code: string, name: string): boolean {
  const path = refPath(code, name)
  return reorderableToStatement(path, path.getStatementParent()!)
}

test('isConditionalGate gates a short-circuited logical or conditional position', () => {
  expect(gated('a && marker;', 'marker')).toBe(true)
  expect(gated('a || marker;', 'marker')).toBe(true)
  expect(gated('cond ? marker : x;', 'marker')).toBe(true)
  expect(gated('cond ? x : marker;', 'marker')).toBe(true)
})

test('isConditionalGate gates an optional member base and computed key', () => {
  expect(gated('marker?.[x];', 'marker')).toBe(true)
  // A02-10: The computed key runs only after the base proves non-nullish.
  expect(gated('a?.[marker];', 'marker')).toBe(true)
})

test('isConditionalGate gates an optional call callee and its arguments', () => {
  expect(gated('marker?.(x);', 'marker')).toBe(true)
  // A02-11: Arguments run only after the callee proves non-nullish.
  expect(gated('a?.(marker);', 'marker')).toBe(true)
})

test('isConditionalGate does not gate unconditional positions', () => {
  expect(gated('marker && a;', 'marker')).toBe(false)
  expect(gated('marker ? a : b;', 'marker')).toBe(false)
  expect(gated('a[marker];', 'marker')).toBe(false)
  expect(gated('a(marker);', 'marker')).toBe(false)
})

test('reorderableToStatement allows a statement-level or unconditional position', () => {
  expect(reorderable('marker;', 'marker')).toBe(true)
  expect(reorderable('function foo() {} foo(marker);', 'marker')).toBe(true)
  expect(reorderable('function foo() {} var a = 1; foo(a, marker);', 'marker')).toBe(true)
})

test('reorderableToStatement refuses a gated position', () => {
  expect(reorderable('a && marker;', 'marker')).toBe(false)
  expect(reorderable('a?.[marker];', 'marker')).toBe(false)
  expect(reorderable('a?.(marker);', 'marker')).toBe(false)
})

test('reorderableToStatement refuses reordering past a preceding side effect', () => {
  // Earlier calls, unresolved reads, and coercion block movement.
  expect(reorderable('function f() {} f(g(), marker);', 'marker')).toBe(false)
  expect(reorderable('missingFn(marker);', 'marker')).toBe(false)
  // A07-08 / A02-13: Object operands invoke ToPrimitive.
  expect(reorderable('function rec() {} var obj = 1; rec(+obj, marker);', 'marker')).toBe(false)
  expect(reorderable('function rec() {} var o = 1; rec(o + 1, marker);', 'marker')).toBe(false)
})

test('reorderableToStatement refuses a compound-assign RHS (target GetValue precedes it)', () => {
  // A02-07: Compound assignment may read a global accessor before its right side.
  expect(reorderable('gx += marker;', 'marker')).toBe(false)
})

test('reorderableToStatement refuses a member-assign RHS whose base read is unproven', () => {
  // A02-08: A member write evaluates its base before the right side.
  expect(reorderable('missingBase.p = marker;', 'marker')).toBe(false)
})

test('reorderableToStatement allows a simple identifier-target assignment RHS', () => {
  expect(reorderable('var x = 0; x = marker;', 'marker')).toBe(true)
})
