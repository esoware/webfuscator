import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import type { ChangeState } from '../utils/change-tracking'

/**
 * Moves `var` declarations to the beginning of their containing function or
 * program without moving initializer evaluation.
 *
 * @example
 * // ◀️ before
 * function f() {
 *   var x = 1;
 *   if (c) {
 *     var y = g();
 *   }
 *   return x + y;
 * }
 *
 * // ▶️ after
 * function f() {
 *   var x, y;
 *   x = 1;
 *   if (c) {
 *     y = g();
 *   }
 *   return x + y;
 * }
 */
export function hoistVariables(ast: File): boolean {
  const state: HoistState = {
    changed: false,
    scopes: new Map(),
  }
  traverse(ast, {
    VariableDeclaration(path) {
      if (path.node.kind !== 'var' || path.parentPath.isExportNamedDeclaration()) {
        return
      }
      const owner = ownerPath(path)
      if (owner === null) {
        return
      }

      const scope = hoistedScope(state.scopes, owner)
      addNames(scope.names, path.getBindingIdentifiers())
      if (scope.declaration?.node === path.node) {
        return
      }

      demoteDeclaration(path)
      scope.changed = true
      state.changed = true
    },
  })

  for (const scope of state.scopes.values()) {
    if (scope.changed) {
      finishDeclaration(scope)
    }
  }

  return state.changed
}

type OwnerPath = NodePath<t.Function | t.Program | t.StaticBlock>

interface HoistState extends ChangeState {
  scopes: Map<t.Node, HoistedScope>
}

interface HoistedScope {
  changed: boolean
  declaration: NodePath<t.VariableDeclaration> | null
  names: Map<string, t.Identifier>
  owner: OwnerPath
}

function ownerPath(path: NodePath<t.VariableDeclaration>): OwnerPath | null {
  let current: NodePath | null = path.parentPath
  while (current) {
    if (current.isStaticBlock()) {
      return current as OwnerPath
    }
    if (current.isProgram()) {
      return current as OwnerPath
    }
    if (t.isFunction(current.node) && t.isBlockStatement(current.node.body)) {
      return current as OwnerPath
    }
    current = current.parentPath
  }
  return null
}

function hoistedScope(scopes: Map<t.Node, HoistedScope>, owner: OwnerPath): HoistedScope {
  const existing = scopes.get(owner.node)
  if (existing) {
    return existing
  }

  const declaration = leadingBareDeclaration(owner)
  const scope: HoistedScope = {
    changed: false,
    declaration,
    names: new Map(),
    owner,
  }
  if (declaration) {
    addNames(scope.names, declaration.getBindingIdentifiers())
  }
  scopes.set(owner.node, scope)
  return scope
}

function leadingBareDeclaration(owner: OwnerPath): NodePath<t.VariableDeclaration> | null {
  const first = ownerBody(owner)[0]
  if (!first?.isVariableDeclaration({ kind: 'var' })) {
    return null
  }
  return first.node.declarations.every((declarator) => declarator.init == null) ? first : null
}

function ownerBody(owner: OwnerPath): NodePath<t.Statement>[] {
  if (owner.isFunction()) {
    const body = owner.get('body')
    return body.isBlockStatement() ? (body.get('body') as NodePath<t.Statement>[]) : []
  }
  return owner.get('body') as NodePath<t.Statement>[]
}

function demoteDeclaration(path: NodePath<t.VariableDeclaration>): void {
  const parent = path.parentPath
  if (parent.isForStatement() && path.key === 'init') {
    demoteForInit(path)
    return
  }
  if ((parent.isForInStatement() || parent.isForOfStatement()) && path.key === 'left') {
    demoteForX(path, parent)
    return
  }

  const assignments = initializerAssignments(path.node).map((expression) =>
    t.expressionStatement(expression),
  )

  if (typeof path.listKey === 'string') {
    if (assignments.length === 0) {
      path.remove()
    } else {
      path.replaceWithMultiple(assignments)
    }
    return
  }
  if (assignments.length === 0) {
    path.replaceWith(t.emptyStatement())
  } else if (assignments.length === 1) {
    path.replaceWith(assignments[0]!)
  } else {
    path.replaceWith(t.blockStatement(assignments))
  }
}

function demoteForInit(path: NodePath<t.VariableDeclaration>): void {
  const assignments = initializerAssignments(path.node)
  if (assignments.length === 0) {
    path.remove()
    return
  }
  const replacement = assignments.length === 1 ? assignments[0]! : t.sequenceExpression(assignments)
  path.replaceWith(replacement)
}

function demoteForX(
  path: NodePath<t.VariableDeclaration>,
  parent: NodePath<t.ForInStatement | t.ForOfStatement>,
): void {
  const declarator = path.node.declarations[0]!
  const target = declarator.id as t.ArrayPattern | t.Identifier | t.ObjectPattern
  if (declarator.init) {
    const assignment = initializerAssignment(declarator, target)
    const right = parent.get('right') as NodePath<t.Expression>
    right.replaceWith(t.sequenceExpression([assignment, right.node]))
  }
  path.replaceWith(t.cloneNode(target))
}

function initializerAssignments(node: t.VariableDeclaration): t.AssignmentExpression[] {
  const assignments: t.AssignmentExpression[] = []
  for (const declarator of node.declarations) {
    if (declarator.init != null) {
      const target = declarator.id as t.ArrayPattern | t.Identifier | t.ObjectPattern
      assignments.push(initializerAssignment(declarator, target))
    }
  }
  return assignments
}

function initializerAssignment(
  declarator: t.VariableDeclarator,
  target: t.ArrayPattern | t.Identifier | t.ObjectPattern,
): t.AssignmentExpression {
  return t.assignmentExpression('=', t.cloneNode(target), declarator.init!)
}

function addNames(
  names: Map<string, t.Identifier>,
  identifiers: Record<string, t.Identifier>,
): void {
  for (const [name, identifier] of Object.entries(identifiers)) {
    if (!names.has(name)) {
      names.set(name, identifier)
    }
  }
}

function finishDeclaration(scope: HoistedScope): void {
  const existingNames = new Set<string>()
  if (scope.declaration) {
    for (const name of Object.keys(scope.declaration.getBindingIdentifiers())) {
      existingNames.add(name)
    }
  }
  const declarators = [...scope.names]
    .filter(([name]) => !existingNames.has(name))
    .map(([, identifier]) => t.variableDeclarator(t.cloneNode(identifier)))

  if (scope.declaration) {
    if (declarators.length > 0) {
      scope.declaration.pushContainer('declarations', declarators)
    }
    return
  }

  if (declarators.length === 0) {
    return
  }

  const declaration = t.variableDeclaration('var', declarators)
  insertDeclaration(scope.owner, declaration)
}

function insertDeclaration(owner: OwnerPath, declaration: t.VariableDeclaration): void {
  if (owner.isFunction()) {
    const body = owner.get('body')
    if (body.isBlockStatement()) {
      body.unshiftContainer('body', declaration)
    }
    return
  }
  if (owner.isProgram()) {
    owner.unshiftContainer('body', declaration)
    return
  }
  if (owner.isStaticBlock()) {
    owner.unshiftContainer('body', declaration)
  }
}
