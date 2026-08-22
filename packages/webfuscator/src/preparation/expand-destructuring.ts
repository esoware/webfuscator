import traverse from '@babel/traverse'
import type { NodePath, Scope } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { enclosingScopeHasDirectEval, isInsideWith } from '../utils/ast'

type Kind = t.VariableDeclaration['kind']

// Babel 8 omits `AssignmentPattern` from `LVal`, so list these targets directly.
type BindingTarget = t.Identifier | t.ObjectPattern | t.ArrayPattern | t.AssignmentPattern

/**
 * Rewrites object destructuring declarations as individual property reads.
 * Array patterns stay intact because indexed reads cannot reproduce the iterator
 * protocol.
 *
 * The source, computed keys, and getters keep their original evaluation counts.
 * Defaults compare against `void 0` because `undefined` can be shadowed.
 *
 * `with` and direct `eval` can expose synthesized names that Babel cannot see, so
 * those scopes are skipped. A `RequireObjectCoercible` guard runs before any
 * computed key, matching ObjectBindingPattern evaluation order.
 *
 * @example
 * // ◀️ before
 * const { a, b: renamed, c = 3 } = obj;
 *
 * // ▶️ after
 * const _ref = obj;
 * const a = _ref.a;
 * const renamed = _ref.b;
 * const _c = _ref.c;
 * const c = _c === void 0 ? 3 : _c;
 */
export function expandDestructuring(ast: File): void {
  traverse(ast, visitor)
}

const visitor = {
  VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
    if (typeof path.listKey !== 'string') {
      return
    }
    // Babel cannot prove a generated name hidden from `with` or direct `eval`.
    if (isInsideWith(path) || enclosingScopeHasDirectEval(path)) {
      return
    }

    const kind = path.node.kind
    const replacement: t.Statement[] = []
    let changed = false

    for (const declarator of path.node.declarations) {
      const id = declarator.id
      const init = declarator.init

      if (
        !init ||
        !t.isObjectPattern(id) ||
        containsRestElement(id) ||
        containsArrayPattern(id) ||
        containsEmptyObjectPattern(id)
      ) {
        replacement.push(t.variableDeclaration(kind, [declarator]))
        continue
      }

      let source: t.Expression = init
      // Snapshot a mutable identifier before reading more than one property.
      if (t.isIdentifier(source) && topLevelReadCount(id) > 1) {
        const temp = path.scope.generateUidIdentifier('ref')
        replacement.push(t.variableDeclaration(kind, [t.variableDeclarator(temp, source)]))
        source = t.cloneNode(temp)
      }

      replacement.push(...expandPattern(kind, id, source, path.scope))
      changed = true
    }

    if (changed) {
      path.replaceWithMultiple(replacement)
    }
  },
}

function expandPattern(
  kind: Kind,
  target: BindingTarget,
  source: t.Expression,
  scope: Scope,
): t.Statement[] {
  if (t.isIdentifier(target)) {
    return [t.variableDeclaration(kind, [t.variableDeclarator(target, source)])]
  }

  if (t.isAssignmentPattern(target)) {
    const innerName =
      t.isIdentifier(target.left) && t.isValidIdentifier(target.left.name)
        ? scope.generateUid(target.left.name)
        : scope.generateUid('default')
    const innerId = t.identifier(innerName)
    const decls: t.Statement[] = [
      t.variableDeclaration(kind, [t.variableDeclarator(t.cloneNode(innerId), source)]),
    ]
    const defaulted = t.conditionalExpression(
      // `void 0`, not the shadowable identifier `undefined`.
      t.binaryExpression(
        '===',
        t.cloneNode(innerId),
        t.unaryExpression('void', t.numericLiteral(0)),
      ),
      target.right,
      t.cloneNode(innerId),
    )
    decls.push(...expandPattern(kind, target.left as BindingTarget, defaulted, scope))
    return decls
  }

  if (t.isObjectPattern(target)) {
    const decls: t.Statement[] = []
    // Snapshot before repeated or nested property evaluation.
    let src = source
    if (!t.isIdentifier(src)) {
      const temp = scope.generateUidIdentifier('ref')
      decls.push(t.variableDeclaration(kind, [t.variableDeclarator(temp, src)]))
      src = t.cloneNode(temp)
    }
    // `({} = src)` reproduces RequireObjectCoercible before computed keys run.
    if (hasComputedKey(target)) {
      decls.push(
        t.expressionStatement(t.assignmentExpression('=', t.objectPattern([]), t.cloneNode(src))),
      )
    }
    for (const prop of target.properties) {
      if (t.isRestElement(prop)) {
        continue
      }
      const key = prop.key
      const useComputed = prop.computed || !t.isIdentifier(key)
      const access = t.memberExpression(
        t.cloneNode(src),
        t.cloneNode(key) as t.Expression,
        useComputed,
      )
      decls.push(...expandPattern(kind, prop.value as BindingTarget, access, scope))
    }
    return decls
  }

  return [t.variableDeclaration(kind, [t.variableDeclarator(target, source)])]
}

function topLevelReadCount(pattern: t.ObjectPattern): number {
  return pattern.properties.filter((prop) => !t.isRestElement(prop)).length
}

function hasComputedKey(pattern: t.ObjectPattern): boolean {
  return pattern.properties.some((prop) => t.isObjectProperty(prop) && prop.computed)
}

// An empty pattern still throws on nullish input, with no property read to carry
// that check after expansion.
function containsEmptyObjectPattern(pattern: BindingTarget): boolean {
  if (t.isObjectPattern(pattern)) {
    return (
      pattern.properties.length === 0 ||
      pattern.properties.some(
        (prop) =>
          t.isObjectProperty(prop) && containsEmptyObjectPattern(prop.value as BindingTarget),
      )
    )
  }
  if (t.isAssignmentPattern(pattern)) {
    return containsEmptyObjectPattern(pattern.left as BindingTarget)
  }
  return false
}

function containsArrayPattern(pattern: BindingTarget): boolean {
  if (t.isArrayPattern(pattern)) {
    return true
  }
  if (t.isObjectPattern(pattern)) {
    return pattern.properties.some(
      (prop) => t.isObjectProperty(prop) && containsArrayPattern(prop.value as BindingTarget),
    )
  }
  if (t.isAssignmentPattern(pattern)) {
    return containsArrayPattern(pattern.left as BindingTarget)
  }
  return false
}

function containsRestElement(pattern: BindingTarget): boolean {
  if (t.isObjectPattern(pattern)) {
    return pattern.properties.some(
      (prop) =>
        t.isRestElement(prop) ||
        (t.isObjectProperty(prop) && containsRestElement(prop.value as BindingTarget)),
    )
  }
  if (t.isArrayPattern(pattern)) {
    return pattern.elements.some(
      (el) => el !== null && (t.isRestElement(el) || containsRestElement(el as BindingTarget)),
    )
  }
  if (t.isAssignmentPattern(pattern)) {
    return containsRestElement(pattern.left as BindingTarget)
  }
  return false
}
