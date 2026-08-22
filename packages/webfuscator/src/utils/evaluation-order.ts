import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

import { isPure } from '../analysis/purity'

// Moving a gated node can change whether it runs.
export function isConditionalGate(parent: NodePath, cur: NodePath): boolean {
  if (parent.isLogicalExpression() && parent.node.right === cur.node) {
    return true
  }
  if (
    parent.isConditionalExpression() &&
    (parent.node.consequent === cur.node || parent.node.alternate === cur.node)
  ) {
    return true
  }
  if (parent.isOptionalMemberExpression()) {
    // Computed keys run only after the optional base proves non-nullish.
    if (parent.node.object === cur.node) {
      return parent.node.optional
    }
    if (parent.node.computed && parent.node.property === cur.node) {
      return true
    }
  }
  if (parent.isOptionalCallExpression()) {
    if (parent.node.callee === cur.node) {
      return parent.node.optional
    }
    // Arguments run only once the callee proves non-nullish.
    if (parent.node.arguments.some((arg) => arg === cur.node)) {
      return true
    }
  }
  return false
}

// Hoisting to statement position requires no gate or earlier observable work.
export function reorderableToStatement(path: NodePath, stmtPath: NodePath): boolean {
  let cur: NodePath = path
  let parent = cur.parentPath
  while (parent && parent !== stmtPath) {
    if (isConditionalGate(parent, cur)) {
      return false
    }
    if (precedingEvaluationHasSideEffect(parent, cur)) {
      return false
    }
    cur = parent
    parent = cur.parentPath
  }
  return true
}

// Unknown parent shapes are unsafe. Known operands use `isPure` with their live
// scope and path.
function precedingEvaluationHasSideEffect(parentPath: NodePath, curPath: NodePath): boolean {
  const parent = parentPath.node
  const cur = curPath.node

  if (t.isBinaryExpression(parent)) {
    return parent.right === cur && impure([parentPath.get('left') as NodePath])
  }
  if (
    t.isLogicalExpression(parent) ||
    t.isUnaryExpression(parent) ||
    t.isSpreadElement(parent) ||
    t.isVariableDeclarator(parent)
  ) {
    return false
  }
  if (t.isVariableDeclaration(parent)) {
    const declarators = precedingSiblings(parentPath, 'declarations', cur)
    return impure(declarators.map((decl) => decl.get('init') as NodePath))
  }
  if (t.isAssignmentExpression(parent) && parent.right === cur) {
    const target = parentPath.get('left') as NodePath
    // Compound assignment reads its target before the right side. Plain `=`
    // only resolves the write reference.
    if (parent.operator === '=') {
      return !writeReferenceIsPure(target)
    }
    return !compoundTargetReadIsPure(target)
  }
  if (t.isSequenceExpression(parent)) {
    return impure(precedingSiblings(parentPath, 'expressions', cur))
  }
  if (
    t.isCallExpression(parent) ||
    t.isOptionalCallExpression(parent) ||
    t.isNewExpression(parent)
  ) {
    const args = parentPath.get('arguments') as NodePath[]
    const index = args.findIndex((arg) => arg.node === cur)
    if (index === -1) {
      return false
    }
    return impure([parentPath.get('callee') as NodePath, ...args.slice(0, index)])
  }
  if (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) {
    return parent.property === cur && impure([parentPath.get('object') as NodePath])
  }
  if (t.isArrayExpression(parent)) {
    return impure(precedingSiblings(parentPath, 'elements', cur))
  }
  if (t.isObjectProperty(parent)) {
    return parent.value === cur && parent.computed && impure([parentPath.get('key') as NodePath])
  }
  if (t.isObjectExpression(parent)) {
    return precedingSiblings(parentPath, 'properties', cur).some((prop) => !propertyIsPure(prop))
  }
  if (t.isTemplateLiteral(parent)) {
    return impure(precedingSiblings(parentPath, 'expressions', cur))
  }
  if (t.isConditionalExpression(parent)) {
    // Branches were caught as gates, leaving only the test here.
    return false
  }
  return true
}

// List entries evaluated before `cur` are the ones a hoist must cross.
function precedingSiblings<T extends NodePath>(
  parentPath: NodePath,
  listKey: string,
  cur: t.Node,
): T[] {
  const siblings = parentPath.get(listKey) as T[]
  return siblings.slice(
    0,
    siblings.findIndex((sibling) => sibling.node === cur),
  )
}

function isPurePath(path: NodePath): boolean {
  return isPure(path.node, path.scope, path)
}

function impure(paths: (NodePath | null | undefined)[]): boolean {
  return paths.some((path) => path != null && path.node != null && !isPurePath(path))
}

// Member targets evaluate their base and computed key before the right side.
function writeReferenceIsPure(target: NodePath): boolean {
  if (target.isIdentifier()) {
    return true
  }
  if (target.isMemberExpression()) {
    return (
      isPurePath(target.get('object') as NodePath) &&
      (!target.node.computed || isPurePath(target.get('property') as NodePath))
    )
  }
  return false
}

// Compound assignment reads the target. Members and unresolved names may invoke
// accessors.
function compoundTargetReadIsPure(target: NodePath): boolean {
  return target.isIdentifier() && isPurePath(target)
}

function propertyIsPure(propPath: NodePath): boolean {
  const prop = propPath.node
  if (t.isSpreadElement(prop)) {
    return false
  }
  if (t.isObjectMethod(prop)) {
    return !prop.computed || isPurePath(propPath.get('key') as NodePath)
  }
  if (t.isObjectProperty(prop)) {
    if (prop.computed && !isPurePath(propPath.get('key') as NodePath)) {
      return false
    }
    return t.isExpression(prop.value) && isPurePath(propPath.get('value') as NodePath)
  }
  return false
}
