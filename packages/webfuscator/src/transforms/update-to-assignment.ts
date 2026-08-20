import type { Binding, NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isDirectEvalCall, isInsideWith } from 'src/utils/ast'
import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'

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
    const { argument, prefix, operator } = path.node
    if (!t.isIdentifier(argument)) {
      return
    }
    if (!prefix && !valueIsDiscarded(path)) {
      return
    }
    // `with` can retarget the name and defeat the numeric proof.
    if (isInsideWith(path)) {
      return
    }
    const binding = path.scope.getBinding(argument.name)
    if (!isNumericBinding(binding)) {
      return
    }
    // Direct eval anywhere in the binding's scope can change its type.
    if (bindingScopeReachesDirectEval(binding!)) {
      return
    }
    const compound = operator === '++' ? '+=' : '-='
    path.replaceWith(t.assignmentExpression(compound, argument, t.numericLiteral(1)))
    state.changed = true
  },
}

function valueIsDiscarded(path: NodePath<t.UpdateExpression>): boolean {
  const { parentPath } = path
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

// The initializer and every mutation must keep the binding numeric.
function isNumericBinding(binding: Binding | undefined): boolean {
  if (!binding || (binding.kind !== 'var' && binding.kind !== 'let')) {
    return false
  }
  const declarator = binding.path.node
  if (!t.isVariableDeclarator(declarator) || !t.isNumericLiteral(declarator.init)) {
    return false
  }
  // Babel misses the string writes from an Annex B `for-in` initializer.
  if (isForInOfLoopVariable(binding)) {
    return false
  }
  return binding.constantViolations.every((violation) => keepsNumeric(violation.node))
}

// A sibling or nested direct eval can still close over and reassign the binding.
function bindingScopeReachesDirectEval(binding: Binding): boolean {
  let found = false
  t.traverseFast(binding.scope.block, (node) => {
    if (isDirectEvalCall(node)) {
      found = true
    }
    return found ? t.traverseFast.stop : undefined
  })
  return found
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
