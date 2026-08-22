import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { Binding, NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { expect, test } from 'vitest'

import {
  declarationReaches,
  initializerReaches,
  readCrossesFunctionBoundary,
} from '../../src/analysis/document-order'

// Resolve a declaration and its first non-binding reference.
function bindingAndReference(code: string, name: string): { binding: NodePath; ref: NodePath } {
  const ast = parse(code, { sourceType: 'unambiguous' })
  let binding: NodePath | undefined
  let ref: NodePath | undefined
  traverse(ast, {
    Identifier(path) {
      if (path.node.name !== name) {
        return
      }
      if (path.parentPath.isVariableDeclarator({ id: path.node }) && !binding) {
        binding = path.parentPath
        return
      }
      if (path.isReferencedIdentifier() && !ref) {
        ref = path
      }
    },
  })
  if (!binding || !ref) {
    throw new Error(`could not locate binding+reference for ${name} in: ${code}`)
  }
  return { binding, ref }
}

test('initializerReaches accepts a straight-line predecessor', () => {
  const { binding, ref } = bindingAndReference('var x = 5; log(x);', 'x')
  expect(declarationReaches(binding, ref)).toBe(true)
  expect(initializerReaches(binding, ref)).toBe(true)
})

test('initializerReaches accepts a same-block loop-body predecessor', () => {
  const { binding, ref } = bindingAndReference(
    'function f(){ for (var i=0;i<3;i++){ var c = 7; log(c); } }',
    'c',
  )
  expect(initializerReaches(binding, ref)).toBe(true)
})

test('initializerReaches refuses a declarator nested in an if branch', () => {
  const { binding, ref } = bindingAndReference(
    'function f(a){ if (a) { var x = 5; } log(x); }',
    'x',
  )
  expect(declarationReaches(binding, ref)).toBe(true)
  expect(initializerReaches(binding, ref)).toBe(false)
})

test('initializerReaches refuses a declarator nested in a try or loop the reference is outside of', () => {
  const tryCase = bindingAndReference('function f(){ try { var x = 5; } finally {} log(x); }', 'x')
  expect(initializerReaches(tryCase.binding, tryCase.ref)).toBe(false)
  const whileCase = bindingAndReference(
    'function f(n){ while (n) { var x = 5; break; } log(x); }',
    'x',
  )
  expect(initializerReaches(whileCase.binding, whileCase.ref)).toBe(false)
})

test('initializerReaches refuses a declarator a break can skip out of a labeled block', () => {
  const { binding, ref } = bindingAndReference(
    'function f(){ L: { break L; var x = 5; } log(x); }',
    'x',
  )
  expect(declarationReaches(binding, ref)).toBe(true)
  expect(initializerReaches(binding, ref)).toBe(false)
})

test('initializerReaches refuses a reference that precedes the declarator', () => {
  const ast = parse('log(x); var x = 5;', { sourceType: 'unambiguous' })
  let binding: NodePath | undefined
  let ref: NodePath | undefined
  traverse(ast, {
    Identifier(path) {
      if (path.node.name !== 'x') {
        return
      }
      if (path.parentPath.isVariableDeclarator({ id: path.node })) {
        binding = path.parentPath
      } else if (path.isReferencedIdentifier()) {
        ref = path
      }
    },
  })
  expect(t.isVariableDeclarator(binding!.node)).toBe(true)
  expect(initializerReaches(binding!, ref!)).toBe(false)
})

test('the predicates treat a detached binding path as not reaching (no throw)', () => {
  // A spliced declaration can leave a stale binding path with no node.
  const { binding, ref } = bindingAndReference('var a = 1, b = 2; typeof a;', 'a')
  binding.remove()
  expect(binding.node).toBeNull()
  expect(() => declarationReaches(binding, ref)).not.toThrow()
  expect(() => initializerReaches(binding, ref)).not.toThrow()
  expect(declarationReaches(binding, ref)).toBe(false)
  expect(initializerReaches(binding, ref)).toBe(false)
})

// Resolve a binding and its first read for TDZ checks.
function bindingObjectAndReference(
  code: string,
  name: string,
): { binding: Binding; ref: NodePath } {
  const ast = parse(code, { sourceType: 'unambiguous' })
  let binding: Binding | undefined
  let ref: NodePath | undefined
  traverse(ast, {
    Identifier(path) {
      if (path.node.name !== name || !path.isReferencedIdentifier() || ref) {
        return
      }
      ref = path
      binding = path.scope.getBinding(name)
    },
  })
  if (!binding || !ref) {
    throw new Error(`could not locate binding+reference for ${name} in: ${code}`)
  }
  return { binding, ref }
}

test('readCrossesFunctionBoundary refuses a read from a nested function', () => {
  const nested = bindingObjectAndReference('let x = 1; function f() { return x; }', 'x')
  expect(readCrossesFunctionBoundary(nested.binding, nested.ref)).toBe(true)
  const arrow = bindingObjectAndReference('let x = 1; var g = () => x;', 'x')
  expect(readCrossesFunctionBoundary(arrow.binding, arrow.ref)).toBe(true)
})

test('readCrossesFunctionBoundary accepts a read in the binding scope itself', () => {
  const sameScope = bindingObjectAndReference('let x = 1; log(x);', 'x')
  expect(readCrossesFunctionBoundary(sameScope.binding, sameScope.ref)).toBe(false)
  const innerBlock = bindingObjectAndReference('function f(){ let x = 1; { log(x); } }', 'x')
  expect(readCrossesFunctionBoundary(innerBlock.binding, innerBlock.ref)).toBe(false)
  const ownFunction = bindingObjectAndReference('function f(){ let x = 1; return x; }', 'x')
  expect(readCrossesFunctionBoundary(ownFunction.binding, ownFunction.ref)).toBe(false)
})

test('readCrossesFunctionBoundary treats a missing reference as not crossing', () => {
  const { binding } = bindingObjectAndReference('let x = 1; log(x);', 'x')
  expect(readCrossesFunctionBoundary(binding, undefined)).toBe(false)
})
