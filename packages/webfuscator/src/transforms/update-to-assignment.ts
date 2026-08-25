import type { Binding, NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Rewrites numeric updates as compound assignments for later expansion. Prefix
 * results already match. Postfix forms require a position that discards the old
 * value.
 *
 * BigInt differs because adding the number `1` throws. Only bindings proven to
 * stay numeric are rewritten. Members and parameters stay unchanged.
 *
 * @example
 * // ◀️ before
 * let i = 0;
 * i++;
 * arr[++i] = 1;
 * let n = 5n;
 * n++;
 *
 * // ▶️ after
 * let i = 0;
 * i += 1;
 * arr[i += 1] = 1;
 * let n = 5n;
 * n++;
 */
export function updateToAssignment(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  UpdateExpression(path, state) {
    const argument = path.node.argument
    const prefix = path.node.prefix
    const operator = path.node.operator
    if (!t.isIdentifier(argument)) {
      return
    }
    if (!prefix && !valueIsDiscarded(path)) {
      return
    }
    const binding = path.scope.getBinding(argument.name)
    if (!isNumericBinding(binding)) {
      return
    }
    const compound = operator === '++' ? '+=' : '-='
    path.replaceWith(t.assignmentExpression(compound, argument, t.numericLiteral(1)))
    state.changed = true
  },
}

function valueIsDiscarded(path: NodePath<t.UpdateExpression>): boolean {
  const parentPath = path.parentPath
  if (!parentPath) {
    return false
  }
  if (parentPath.isExpressionStatement()) {
    return true
  }
  if (parentPath.isForStatement() && parentPath.node.update === path.node) {
    return true
  }
  if (parentPath.isSequenceExpression()) {
    return parentPath.node.expressions.at(-1) !== path.node
  }
  return false
}

// Mutable bindings must stay numeric. A const write cannot change its value.
function isNumericBinding(binding: Binding | undefined): boolean {
  if (!binding || (binding.kind !== 'var' && binding.kind !== 'let' && binding.kind !== 'const')) {
    return false
  }
  const declarator = binding.path.node
  if (!t.isVariableDeclarator(declarator) || !t.isNumericLiteral(declarator.init)) {
    return false
  }
  // Babel does not record each value assigned by a `for-in` or `for-of` head.
  if (isForInOfLoopVariable(binding)) {
    return false
  }
  if (binding.kind === 'const') {
    return true
  }
  return binding.constantViolations.every((violation) => keepsNumeric(violation.node))
}

function isForInOfLoopVariable(binding: Binding): boolean {
  const declaration = binding.path.parentPath
  if (!declaration || !declaration.isVariableDeclaration()) {
    return false
  }
  const loop = declaration.parentPath
  return (
    loop != null &&
    (loop.isForInStatement() || loop.isForOfStatement()) &&
    loop.node.left === declaration.node
  )
}

function keepsNumeric(node: t.Node): boolean {
  if (t.isUpdateExpression(node)) {
    return true
  }
  if (t.isVariableDeclarator(node)) {
    return t.isNumericLiteral(node.init)
  }
  if (t.isAssignmentExpression(node)) {
    return t.isNumericLiteral(node.right)
  }
  return false
}
