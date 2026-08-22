import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isProtoKey } from '../utils/ast'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Rewrites generator and async object methods as function-valued properties so
 * later passes can lift and inline them.
 *
 * Plain methods stay concise because a function property would gain construction
 * and `prototype`. Generator and async functions remain non-constructors. Any
 * method using `super` also stays intact because a function has no HomeObject.
 *
 * Non-computed `__proto__` methods stay intact because the property form invokes
 * ECMA-262 B.3.1 prototype-setting behavior. Computed keys create own properties
 * and remain safe.
 *
 * @example
 * // ◀️ before
 * const o = {
 *   async *stream() {},
 *   plain() {},
 *   get x() {
 *     return 1;
 *   },
 * };
 *
 * // ▶️ after
 * const o = {
 *   stream: async function* () {},
 *   plain() {},
 *   get x() {
 *     return 1;
 *   },
 * };
 */
export function objectMethodToProperty(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  ObjectMethod(path, state) {
    const node = path.node
    if (node.kind !== 'method' || (!node.generator && !node.async)) {
      return
    }
    if (referencesSuper(path)) {
      return
    }
    if (isNonComputedProtoKey(node)) {
      return
    }
    const fn = t.functionExpression(null, node.params, node.body, node.generator, node.async)
    path.replaceWith(t.objectProperty(node.key, fn, node.computed, false))
    state.changed = true
  },
}

function isNonComputedProtoKey(node: t.ObjectMethod): boolean {
  return !node.computed && isProtoKey(node.key)
}

function referencesSuper(path: NodePath<t.ObjectMethod>): boolean {
  const state = { found: false }
  path.traverse(superVisitor, state)
  return state.found
}

const superVisitor: Visitor<{ found: boolean }> = {
  Function(path, state) {
    if (path.isArrowFunctionExpression()) {
      return
    }
    // A nested method's computed key can still use the outer HomeObject.
    if ((path.isObjectMethod() || path.isClassMethod()) && path.node.computed) {
      path.get('key').traverse(superVisitor, state)
    }
    path.skip()
  },
  Super(_path, state) {
    state.found = true
  },
}
