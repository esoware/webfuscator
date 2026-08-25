import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

import { isSideEffectFree } from '../analysis/purity'
import { isStandaloneDeclaration } from './paths'

// Lowers a short-circuit expression assigned to a bare identifier:
//
//   x = L;
//   if (<fallbackTest(x)>) x = R;
//
// `fallbackTest` selects the short-circuit condition. The parent must accept a
// multi-statement replacement.
export function lowerLogicalWriteStatement(
  path: NodePath<t.LogicalExpression>,
  fallbackTest: (target: t.Identifier) => t.Expression,
): boolean {
  const node = path.node
  const parent = path.parentPath
  if (!parent) {
    return false
  }

  if (
    parent.isVariableDeclarator() &&
    parent.node.init === node &&
    t.isIdentifier(parent.node.id)
  ) {
    const declStmt = parent.parentPath
    if (
      !declStmt?.isVariableDeclaration() ||
      declStmt.node.declarations.length !== 1 ||
      !isStandaloneDeclaration(declStmt)
    ) {
      return false
    }
    const target = parent.node.id
    // A `var` initializer can observe its previous value while evaluating the
    // right side. Reads before lexical initialization are intentionally ignored.
    if (declStmt.node.kind === 'var' && rightCanObserveTarget(node.right, target.name)) {
      return false
    }
    const declarationKind = declStmt.node.kind === 'const' ? 'let' : declStmt.node.kind
    declStmt.replaceWithMultiple([
      t.variableDeclaration(declarationKind, [
        t.variableDeclarator(t.cloneNode(target), node.left),
      ]),
      guardedReassignment(target, fallbackTest, node.right),
    ])
    return true
  }

  if (
    parent.isAssignmentExpression() &&
    parent.node.operator === '=' &&
    parent.node.right === node &&
    t.isIdentifier(parent.node.left)
  ) {
    const exprStmt = parent.parentPath
    if (!exprStmt?.isExpressionStatement() || exprStmt.node.expression !== parent.node) {
      return false
    }
    const target = parent.node.left
    // An unresolved name may be a global accessor. The split adds a getter read
    // and can add a second setter call.
    if (!path.scope.getBinding(target.name)) {
      return false
    }
    // Writing first would change `x = 0 || x` before the right side reads `x`.
    if (!isSideEffectFree(node.right, path.scope) || referencesName(node.right, target.name)) {
      return false
    }
    exprStmt.replaceWithMultiple([
      t.expressionStatement(t.assignmentExpression('=', t.cloneNode(target), node.left)),
      guardedReassignment(target, fallbackTest, node.right),
    ])
    return true
  }

  return false
}

// Calls, getters, and suspension can observe the target through code outside the
// expression, even when the target name does not appear directly.
function rightCanObserveTarget(rightNode: t.Node, targetName: string): boolean {
  let observes = false
  t.traverseFast(rightNode, (node) => {
    if (
      (t.isIdentifier(node) && node.name === targetName) ||
      t.isCallExpression(node) ||
      t.isOptionalCallExpression(node) ||
      t.isNewExpression(node) ||
      t.isTaggedTemplateExpression(node) ||
      t.isMemberExpression(node) ||
      t.isOptionalMemberExpression(node) ||
      t.isAwaitExpression(node) ||
      t.isYieldExpression(node)
    ) {
      observes = true
    }
    return observes ? t.traverseFast.stop : undefined
  })
  return observes
}

function referencesName(node: t.Node, name: string): boolean {
  let found = false
  t.traverseFast(node, (child) => {
    if (!found && t.isIdentifier(child) && child.name === name) {
      found = true
    }
    return found ? t.traverseFast.skip : undefined
  })
  return found
}

function guardedReassignment(
  target: t.Identifier,
  fallbackTest: (target: t.Identifier) => t.Expression,
  value: t.Expression,
): t.IfStatement {
  return t.ifStatement(
    fallbackTest(t.cloneNode(target)),
    t.blockStatement([
      t.expressionStatement(t.assignmentExpression('=', t.cloneNode(target), value)),
    ]),
  )
}
