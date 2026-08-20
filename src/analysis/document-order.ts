import type { Binding, NodePath } from '@babel/traverse'
import * as t from '@babel/types'

// AST ancestry gives cloned and synthesized nodes an order when offsets cannot.
export function declarationReaches(
  bindingPath: NodePath,
  referencePath: NodePath | undefined,
): boolean {
  if (!referencePath) {
    return true
  }
  if (!bothPathsOrdered(bindingPath, referencePath)) {
    return false
  }
  return precedesInAncestry(bindingPath, ancestry(referencePath))
}

// Detached paths and a path compared with itself prove no useful ordering.
function bothPathsOrdered(bindingPath: NodePath, referencePath: NodePath): boolean {
  return bindingPath !== referencePath && bindingPath.node != null && referencePath.node != null
}

function precedesInAncestry(bindingPath: NodePath, referenceAncestry: NodePath[]): boolean {
  const bindingAncestry = ancestry(bindingPath)
  let i = bindingAncestry.length - 1
  let j = referenceAncestry.length - 1
  while (i >= 0 && j >= 0 && bindingAncestry[i] === referenceAncestry[j]) {
    i--
    j--
  }
  if (i < 0) {
    return true
  }
  if (j < 0) {
    return false
  }
  return siblingPrecedes(bindingAncestry[i]!, referenceAncestry[j]!)
}

// A declaration inside one of these statements may not run before an outside
// reference, even when it appears first.
const CONDITIONAL_CONTAINERS = new Set<t.Node['type']>([
  'IfStatement',
  'SwitchStatement',
  'SwitchCase',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'TryStatement',
  'ConditionalExpression',
  'LogicalExpression',
  // A labeled block can exit before a later declaration.
  'LabeledStatement',
])

// No branch may separate the initializer from the reference while walking to
// their nearest shared ancestor.
export function initializerReaches(
  bindingPath: NodePath,
  referencePath: NodePath | undefined,
): boolean {
  if (!referencePath) {
    return true
  }
  if (!bothPathsOrdered(bindingPath, referencePath)) {
    return false
  }
  const referenceAncestry = ancestry(referencePath)
  if (!precedesInAncestry(bindingPath, referenceAncestry)) {
    return false
  }
  const referenceAncestors = new Set<NodePath>(referenceAncestry)
  let current: NodePath | null = bindingPath.parentPath
  while (current && !referenceAncestors.has(current)) {
    // A detached ancestor invalidates the remaining path chain.
    if (!current.node) {
      return false
    }
    if (CONDITIONAL_CONTAINERS.has(current.node.type)) {
      return false
    }
    current = current.parentPath
  }
  return true
}

// A nested function may run before the declaration, defeating document order.
export function readCrossesFunctionBoundary(
  binding: Binding,
  referencePath: NodePath | undefined,
): boolean {
  if (!referencePath) {
    return false
  }
  const bindingBlock = binding.scope.block
  let current: NodePath | null = referencePath.parentPath
  while (current) {
    if (current.node === bindingBlock) {
      return false
    }
    if (current.isFunction()) {
      return true
    }
    current = current.parentPath
  }
  return false
}

function ancestry(path: NodePath): NodePath[] {
  const chain: NodePath[] = []
  let current: NodePath | null = path
  while (current) {
    chain.push(current)
    current = current.parentPath
  }
  return chain
}

function siblingPrecedes(left: NodePath, right: NodePath): boolean {
  if (left.listKey && left.listKey === right.listKey) {
    return (left.key as number) < (right.key as number)
  }
  const parent = left.parentPath?.node
  if (!parent) {
    return false
  }
  const slotLeft = (left.listKey ?? left.key) as string
  const slotRight = (right.listKey ?? right.key) as string
  const keys = (t.VISITOR_KEYS as Record<string, string[]>)[parent.type]
  if (!keys) {
    return false
  }
  const indexLeft = keys.indexOf(slotLeft)
  const indexRight = keys.indexOf(slotRight)
  if (indexLeft === -1 || indexRight === -1) {
    return false
  }
  return indexLeft < indexRight
}
