import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { enclosingScopeHasDirectEval, isInsideWith } from '../utils/ast'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Lowers arrows with Babel's capture-aware `arrowFunctionToExpression`. Arrows
 * that reach `super` stay intact. Values that escape visible call positions also
 * stay intact because only the arrow rejects construction with `new`.
 *
 * @example
 * // ◀️ before
 * var fn = x => {
 *   return x + 1;
 * };
 * var thisFn = function () {
 *   var read = () => {
 *     return this.x;
 *   };
 *   return read();
 * };
 * var escapes = [() => 1];
 * class Sub extends Base {
 *   m() {
 *     var call = () => super.m();
 *     return call();
 *   }
 * }
 *
 * // ▶️ after
 * var fn = function (x) {
 *   return x + 1;
 * };
 * var thisFn = function () {
 *   var _this = this;
 *   var read = function () {
 *     return _this.x;
 *   };
 *   return read();
 * };
 * var escapes = [() => 1];
 * class Sub extends Base {
 *   m() {
 *     var call = () => super.m();
 *     return call();
 *   }
 * }
 */
export function arrowToFunction(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  ArrowFunctionExpression(path, state) {
    if (!path.isArrowFunctionExpression()) {
      return
    }
    if (
      // The lowered function gains construction and `prototype`. Every use must
      // remain visible so those differences cannot be observed.
      !valueStaysInView(path) ||
      arrowReferencesSuper(path) ||
      inUnsafeCaptureContext(path) ||
      usesReassignedArguments(path) ||
      // `with` can shadow capture aliases, and direct eval can inspect the changed
      // runtime meaning of `this` or `arguments`.
      isInsideWith(path) ||
      enclosingScopeHasDirectEval(path)
    ) {
      return
    }
    path.arrowFunctionToExpression({
      allowInsertArrow: false,
      noNewArrows: true,
    })
    state.changed = true
  },
}

// Babel places captures in the nearest function body. Fields, static blocks,
// parameter defaults, and computed method keys evaluate in a different scope or
// at a different time.
function inUnsafeCaptureContext(path: NodePath<t.ArrowFunctionExpression>): boolean {
  for (let current: NodePath | null = path.parentPath; current; current = current.parentPath) {
    if (current.isStaticBlock() || current.isClassProperty() || current.isClassPrivateProperty()) {
      return true
    }
    if (current.isFunction()) {
      if (current.isArrowFunctionExpression()) {
        continue
      }
      return arrowIsOutsideBodyOf(path, current)
    }
    if (current.isProgram()) {
      return false
    }
  }
  return false
}

// Captures placed in the body cannot serve parameter defaults or computed keys.
function arrowIsOutsideBodyOf(path: NodePath, fnPath: NodePath): boolean {
  let child: NodePath = path
  for (;;) {
    const next: NodePath | null = child.parentPath
    if (!next || next === fnPath) {
      break
    }
    child = next
  }
  return child.listKey === 'params' || child.key === 'key'
}

// A capture snapshots `arguments` before any later reassignment.
function usesReassignedArguments(path: NodePath<t.ArrowFunctionExpression>): boolean {
  if (!referencesName(path, 'arguments')) {
    return false
  }
  const fnPath = nearestNonArrowFunction(path)
  return fnPath != null && reassignsName(fnPath, 'arguments')
}

// Immediate calls, discarded values, and bindings used only for immediate calls
// keep every use visible. Any other escape could expose construction, binding,
// or `prototype` behavior.
function valueStaysInView(valuePath: NodePath): boolean {
  const parent = valuePath.parentPath
  if (!parent) {
    return false
  }
  if (isImmediateCallee(valuePath, parent) || parent.isExpressionStatement()) {
    return true
  }
  if (
    !parent.isVariableDeclarator() ||
    parent.node.init !== valuePath.node ||
    !t.isIdentifier(parent.node.id)
  ) {
    return false
  }
  const binding = valuePath.scope.getBinding(parent.node.id.name)
  if (!binding || !binding.constant) {
    return false
  }
  return binding.referencePaths.every(
    (ref) => ref.parentPath != null && isImmediateCallee(ref, ref.parentPath),
  )
}

function isImmediateCallee(valuePath: NodePath, parent: NodePath): boolean {
  return (
    (parent.isCallExpression() || parent.isOptionalCallExpression()) &&
    parent.node.callee === valuePath.node
  )
}

function referencesName(path: NodePath, name: string): boolean {
  let found = false
  path.traverse({
    Function(inner) {
      if (!inner.isArrowFunctionExpression()) {
        inner.skip()
      }
    },
    Identifier(inner) {
      if (inner.node.name === name && inner.isReferencedIdentifier()) {
        found = true
      }
    },
  })
  return found
}

function reassignsName(fnPath: NodePath, name: string): boolean {
  let found = false
  fnPath.traverse({
    Function(inner) {
      // Nested arrows share this function's `arguments` binding.
      if (!inner.isArrowFunctionExpression()) {
        inner.skip()
      }
    },
    AssignmentExpression(inner) {
      // Destructuring can rebind `arguments`; member writes only mutate it.
      if (Object.hasOwn(t.getBindingIdentifiers(inner.node.left), name)) {
        found = true
      }
    },
    UpdateExpression(inner) {
      if (t.isIdentifier(inner.node.argument, { name })) {
        found = true
      }
    },
  })
  return found
}

function nearestNonArrowFunction(path: NodePath): NodePath | null {
  for (let current: NodePath | null = path.parentPath; current; current = current.parentPath) {
    if (current.isFunction() && !current.isArrowFunctionExpression()) {
      return current
    }
  }
  return null
}

function arrowReferencesSuper(path: NodePath<t.ArrowFunctionExpression>): boolean {
  const state: { found: boolean } = { found: false }
  path.traverse(superCheckVisitor, state)
  return state.found
}

const superCheckVisitor: Visitor<{ found: boolean }> = {
  Function(path) {
    if (!path.isArrowFunctionExpression()) {
      path.skip()
    }
  },
  Super(_path, state) {
    state.found = true
  },
}
