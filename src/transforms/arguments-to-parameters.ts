import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { hasDuplicateParamNames } from 'src/utils/ast'
import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'
import { isInStrictContext } from 'src/utils/paths'

/**
 * Replaces `arguments[i]` reads with their mapped parameter in sloppy functions
 * with simple parameter lists. Writes, deletion, reassigned parameters, and any
 * escape of the arguments object make the mapping unsafe. Missing parameters
 * are never added because that would change `fn.length`.
 *
 * @example
 * // ◀️ before
 * function foo(bar) {
 *   log(arguments[0]);
 * }
 *
 * // ▶️ after
 * function foo(bar) {
 *   log(bar);
 * }
 */
export function argumentsToParameters(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  Function(path, state) {
    if (processFunction(path)) {
      state.changed = true
    }
  },
}

interface CollectState {
  reads: { memPath: NodePath<t.MemberExpression>; index: number }[]
  writtenIndices: Set<number>
  mappingBroken: boolean
}

const collectVisitor: Visitor<CollectState> = {
  Function(innerPath) {
    if (!innerPath.isArrowFunctionExpression()) {
      innerPath.skip()
    }
  },
  Identifier(path, state) {
    if (path.node.name !== 'arguments' || !path.isReferencedIdentifier()) {
      return
    }
    if (path.scope.getBinding('arguments')) {
      return
    }
    const parent = path.parentPath
    // Any other use can expose or mutate the arguments object.
    if (
      (parent.isMemberExpression() || parent.isOptionalMemberExpression()) &&
      parent.node.object === path.node
    ) {
      return
    }
    state.mappingBroken = true
  },
  AssignmentExpression(assignPath, state) {
    // Reassignment replaces the mapped object.
    if (
      t.isIdentifier(assignPath.node.left, { name: 'arguments' }) &&
      !assignPath.scope.getBinding('arguments')
    ) {
      state.mappingBroken = true
    }
  },
  MemberExpression(memPath, state) {
    const obj = memPath.node.object
    if (!t.isIdentifier(obj) || obj.name !== 'arguments') {
      return
    }
    if (memPath.scope.getBinding('arguments')) {
      return
    }

    // Deleting an index breaks its parameter mapping.
    if (memPath.parentPath?.isUnaryExpression({ operator: 'delete' })) {
      state.mappingBroken = true
      return
    }

    if (!memPath.node.computed) {
      return
    }
    const prop = memPath.node.property
    if (!t.isNumericLiteral(prop)) {
      return
    }
    const index = prop.value
    if (!Number.isInteger(index) || index < 0) {
      return
    }

    if (memberIsWriteTarget(memPath)) {
      state.writtenIndices.add(index)
      return
    }
    state.reads.push({ memPath, index })
  },
}

function processFunction(path: NodePath<t.Function>): boolean {
  if (path.isArrowFunctionExpression()) {
    return false
  }
  const { params } = path.node
  // Rest, defaults, and destructuring make `arguments` unmapped.
  if (!params.every((param) => t.isIdentifier(param))) {
    return false
  }
  // Duplicate names map only their last index.
  if (hasDuplicateParamNames(params)) {
    return false
  }
  // Strict-mode `arguments` is not mapped to parameters.
  if (isInStrictContext(path)) {
    return false
  }

  const state: CollectState = { reads: [], writtenIndices: new Set(), mappingBroken: false }
  path.traverse(collectVisitor, state)
  if (state.mappingBroken || state.reads.length === 0) {
    return false
  }

  let changed = false
  for (const { memPath, index } of state.reads) {
    // A written index and its parameter diverge when the argument was omitted.
    if (state.writtenIndices.has(index)) {
      continue
    }
    // Adding a parameter would change `fn.length`.
    const param = params[index]
    if (!param || !t.isIdentifier(param)) {
      continue
    }
    // Reassigned parameters diverge when the argument was omitted.
    const binding = path.scope.getBinding(param.name)
    if (binding && binding.constantViolations.length > 0) {
      continue
    }
    memPath.replaceWith(t.identifier(param.name))
    changed = true
  }
  return changed
}

// Treat any occurrence under a write target as written. The conservative member
// case only skips a safe substitution.
function memberIsWriteTarget(memPath: NodePath<t.MemberExpression>): boolean {
  const directParent = memPath.parentPath?.node
  if (
    directParent &&
    (t.isForInStatement(directParent) || t.isForOfStatement(directParent)) &&
    directParent.left === memPath.node
  ) {
    return true
  }
  // Writes may reach the member through an enclosing destructuring pattern.
  let currentNode: t.Node = memPath.node
  let cursor: NodePath | null = memPath.parentPath
  while (cursor && !cursor.isStatement()) {
    const parent = cursor.node
    if (t.isUpdateExpression(parent)) {
      return true
    }
    if (t.isAssignmentExpression(parent)) {
      return parent.left === currentNode
    }
    if (t.isArrayPattern(parent) || t.isObjectPattern(parent) || t.isRestElement(parent)) {
      return true
    }
    currentNode = parent
    cursor = cursor.parentPath
  }
  return false
}
