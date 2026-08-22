import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isInsideWith } from '../utils/ast'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { isConditionalGate, reorderableToStatement } from '../utils/evaluation-order'
import { isStandaloneDeclaration } from '../utils/paths'

/**
 * Lowers conditional expressions to `if` statements. Expression values use a
 * temporary. Parameter defaults and repeating loop tests stay unchanged because
 * hoisting would change when they run.
 *
 * @example
 * // ◀️ before
 * var y = a ? b : c;
 * log(d ? e : f);
 *
 * // ▶️ after
 * var y;
 * if (a) { y = b; } else { y = c; }
 * var _ternaryResult;
 * if (d) { _ternaryResult = e; } else { _ternaryResult = f; }
 * log(_ternaryResult);
 */
export function ternaryToIf(ast: File): boolean {
  // Flatten sequences and logical gates before lifting ternaries. Replacements
  // detach queued child paths, so every handler checks liveness.
  const preparationChanged = traverseForChanges(ast, preparationVisitor)
  const loweringChanged = traverseForChanges(ast, visitor)
  return preparationChanged || loweringChanged
}

const preparationVisitor: Visitor<ChangeState> = {
  ConditionalExpression(path, state) {
    if (!isPathLive(path) || isInsideWith(path)) {
      return
    }
    const stmtPath = path.getStatementParent()
    if (!stmtPath) {
      return
    }
    if (hoistEnclosingSequence(path, stmtPath) || lowerEnclosingLogical(path, stmtPath)) {
      state.changed = true
    }
  },
}

const visitor: Visitor<ChangeState> = {
  ConditionalExpression(path, state) {
    // Statement replacement detaches queued siblings. `with` can also shadow the
    // synthesized result temporary.
    if (!isPathLive(path) || isInsideWith(path)) {
      return
    }
    if (lowerConditional(path)) {
      state.changed = true
    }
  },
}

function lowerConditional(path: NodePath<t.ConditionalExpression>): boolean {
  const parent = path.parentPath
  if (!parent) {
    return false
  }

  const test = path.node.test
  const consequent = path.node.consequent
  const alternate = path.node.alternate

  if (parent.isExpressionStatement() && parent.node.expression === path.node) {
    parent.replaceWith(
      t.ifStatement(
        test,
        t.blockStatement(seqToExpressionStatements(consequent)),
        t.blockStatement(seqToExpressionStatements(alternate)),
      ),
    )
    // Skip the orphaned path after replacing its parent.
    path.skip()
    return true
  }
  if (parent.isReturnStatement() && parent.node.argument === path.node) {
    parent.replaceWith(
      t.ifStatement(
        test,
        t.blockStatement(seqWithFinal(consequent, t.returnStatement)),
        t.blockStatement(seqWithFinal(alternate, t.returnStatement)),
      ),
    )
    path.skip()
    return true
  }
  if (parent.isThrowStatement() && parent.node.argument === path.node) {
    parent.replaceWith(
      t.ifStatement(
        test,
        t.blockStatement(seqWithFinal(consequent, t.throwStatement)),
        t.blockStatement(seqWithFinal(alternate, t.throwStatement)),
      ),
    )
    path.skip()
    return true
  }
  if (
    parent.isAssignmentExpression() &&
    parent.node.operator === '=' &&
    t.isIdentifier(parent.node.left) &&
    parent.node.right === path.node &&
    parent.parentPath?.isExpressionStatement() &&
    parent.parentPath.node.expression === parent.node
  ) {
    const target = parent.node.left
    parent.parentPath.replaceWith(
      t.ifStatement(
        test,
        t.blockStatement(seqWithAssignment(consequent, target)),
        t.blockStatement(seqWithAssignment(alternate, target)),
      ),
    )
    path.skip()
    return true
  }
  if (
    parent.isVariableDeclarator() &&
    t.isIdentifier(parent.node.id) &&
    parent.node.init === path.node &&
    parent.parentPath?.isVariableDeclaration() &&
    // Splitting lexical declarations would end TDZ early, and bare `const` is
    // invalid. Keep their initializer behind a result temp.
    parent.parentPath.node.kind === 'var' &&
    parent.parentPath.node.declarations.length === 1 &&
    isStandaloneDeclaration(parent.parentPath)
  ) {
    const declPath = parent.parentPath
    const target = parent.node.id
    declPath.replaceWithMultiple([
      t.variableDeclaration(declPath.node.kind, [t.variableDeclarator(t.cloneNode(target))]),
      t.ifStatement(
        test,
        t.blockStatement(seqWithAssignment(consequent, target)),
        t.blockStatement(seqWithAssignment(alternate, target)),
      ),
    ])
    path.skip()
    return true
  }

  const stmtPath = path.getStatementParent()
  if (!stmtPath) {
    return false
  }

  if (isInsideAssignmentPattern(path, stmtPath)) {
    return false
  }
  if (isInsideLoopHeader(path, stmtPath)) {
    return false
  }
  // Lifting requires no short-circuit gate or earlier effect in the statement.
  if (!reorderableToStatement(path, stmtPath)) {
    return false
  }

  const scope = path.scope
  const tmpId = scope.generateUidIdentifier('ternaryResult')
  scope.push({ id: t.cloneNode(tmpId) })

  const ifStmt = t.ifStatement(
    test,
    t.blockStatement([
      t.expressionStatement(t.assignmentExpression('=', t.cloneNode(tmpId), consequent)),
    ]),
    t.blockStatement([
      t.expressionStatement(t.assignmentExpression('=', t.cloneNode(tmpId), alternate)),
    ]),
  )

  // Detach the ternary before reusing its children in the new `if`.
  path.replaceWith(t.cloneNode(tmpId))
  stmtPath.insertBefore(ifStmt)
  return true
}

function isInsideAssignmentPattern(path: NodePath, stmtPath: NodePath): boolean {
  let ancestor: NodePath | null = path.parentPath
  while (ancestor && ancestor !== stmtPath) {
    if (ancestor.isAssignmentPattern()) {
      return true
    }
    ancestor = ancestor.parentPath
  }
  return false
}

// Split the innermost sequence so its ternary reaches a safe statement position.
function hoistEnclosingSequence(path: NodePath, stmtPath: NodePath): boolean {
  const seqPath = findEnclosingSequence(path, stmtPath)
  if (!seqPath) {
    return false
  }
  const elements = seqPath.node.expressions
  if (elements.length < 2) {
    return false
  }
  const seqStmt = seqPath.getStatementParent()
  if (!seqStmt) {
    return false
  }
  // The sequence must run once at statement position without crossing a gate,
  // case test, parameter default, loop header, or earlier effect.
  if (
    isInsideLoopHeader(seqPath, seqStmt) ||
    isInsideAssignmentPattern(seqPath, seqStmt) ||
    isInsideSwitchCaseTest(seqPath, seqStmt) ||
    !reorderableToStatement(seqPath, seqStmt)
  ) {
    return false
  }
  const preceding = elements.slice(0, -1).map((e) => t.expressionStatement(t.cloneNode(e)))
  const last = t.cloneNode(elements.at(-1)!)
  seqPath.replaceWith(last)
  seqStmt.insertBefore(preceding)
  path.skip()
  return true
}

// Hoisting from a case test would run its work before the switch reaches that case.
function isInsideSwitchCaseTest(path: NodePath, stmtPath: NodePath): boolean {
  let ancestor: NodePath | null = path.parentPath
  while (ancestor && ancestor !== stmtPath) {
    if (ancestor.isSwitchCase()) {
      return true
    }
    ancestor = ancestor.parentPath
  }
  return false
}

// A live path must still occupy every recorded parent key up to the Program.
function isPathLive(path: NodePath): boolean {
  let cur: NodePath | null = path
  while (cur) {
    if (!cur.node) {
      return false
    }
    const parent: NodePath | null = cur.parentPath
    if (!parent) {
      return cur.isProgram() || cur.isFile()
    }
    if (!parent.node) {
      return false
    }
    const parentNode = parent.node as unknown as Record<string, unknown>
    let held: unknown = parentNode[cur.key as string]
    if (cur.listKey != null) {
      const arr = parentNode[cur.listKey]
      held = Array.isArray(arr) ? arr[cur.key as number] : arr
    }
    if (held !== cur.node) {
      return false
    }
    cur = parent
  }
  return false
}

function findEnclosingSequence(
  path: NodePath,
  stmtPath: NodePath,
): NodePath<t.SequenceExpression> | null {
  let cur: NodePath = path
  let parent = cur.parentPath
  let found: NodePath<t.SequenceExpression> | null = null
  while (parent && parent !== stmtPath) {
    if (isConditionalGate(parent, cur)) {
      return null
    }
    if (!found && parent.isSequenceExpression()) {
      found = parent as NodePath<t.SequenceExpression>
    }
    cur = parent
    parent = cur.parentPath
  }
  return found
}

// Convert an enclosing logical gate to a conditional so this pass remains
// self-contained and can lower it on the next visit.
function lowerEnclosingLogical(path: NodePath, stmtPath: NodePath): boolean {
  const logical = findEnclosingShortCircuitLogical(path, stmtPath)
  if (!logical || logical.removed || !logical.container) {
    return false
  }
  const node = logical.node
  const left = node.left
  const right = node.right
  let test: t.Expression
  let valueRef: t.Expression
  if (t.isIdentifier(left) && logical.scope.hasBinding(left.name)) {
    test = left
    valueRef = t.cloneNode(left)
  } else {
    const tmp = logical.scope.generateUidIdentifierBasedOnNode(left)
    logical.scope.push({ id: t.cloneNode(tmp) })
    test = t.assignmentExpression('=', t.cloneNode(tmp), left)
    valueRef = t.cloneNode(tmp)
  }
  const testExpr = node.operator === '??' ? t.binaryExpression('!=', test, t.nullLiteral()) : test
  logical.replaceWith(
    node.operator === '&&'
      ? t.conditionalExpression(testExpr, right, valueRef)
      : t.conditionalExpression(testExpr, valueRef, right),
  )
  path.skip()
  return true
}

function findEnclosingShortCircuitLogical(
  path: NodePath,
  stmtPath: NodePath,
): NodePath<t.LogicalExpression> | null {
  let cur: NodePath = path
  let parent = cur.parentPath
  let found: NodePath<t.LogicalExpression> | null = null
  while (parent && parent !== stmtPath) {
    if (!found) {
      if (
        parent.isConditionalExpression() &&
        (parent.node.consequent === cur.node || parent.node.alternate === cur.node)
      ) {
        return null
      }
      if (parent.isLogicalExpression() && parent.node.right === cur.node) {
        found = parent as NodePath<t.LogicalExpression>
      }
    } else if (isConditionalGate(parent, cur)) {
      return null
    }
    cur = parent
    parent = cur.parentPath
  }
  return found
}

// Loop tests and updates repeat, while a `for` initializer runs once.
function isInsideLoopHeader(path: NodePath, stmtPath: NodePath): boolean {
  let ancestor: NodePath | null = path
  while (ancestor && ancestor.parentPath !== stmtPath) {
    ancestor = ancestor.parentPath
  }
  if (!ancestor) {
    return false
  }
  if (stmtPath.isWhileStatement() || stmtPath.isDoWhileStatement()) {
    return ancestor.parentKey === 'test'
  }
  if (stmtPath.isForStatement()) {
    return ancestor.parentKey === 'test' || ancestor.parentKey === 'update'
  }
  return false
}

// Split sequences so later lifts target the right statement.
function seqToExpressionStatements(expr: t.Expression): t.Statement[] {
  if (t.isSequenceExpression(expr)) {
    return expr.expressions.map((e) => t.expressionStatement(e))
  }
  return [t.expressionStatement(expr)]
}

// In return and throw, only the final sequence element supplies the value.
function seqWithFinal(expr: t.Expression, build: (e: t.Expression) => t.Statement): t.Statement[] {
  if (t.isSequenceExpression(expr)) {
    const last = expr.expressions.at(-1)!
    const init = expr.expressions.slice(0, -1).map((e) => t.expressionStatement(e))
    return [...init, build(last)]
  }
  return [build(expr)]
}

// In a bare assignment, only the final sequence element supplies the value.
function seqWithAssignment(expr: t.Expression, target: t.Identifier): t.Statement[] {
  const build = (value: t.Expression): t.Statement =>
    t.expressionStatement(t.assignmentExpression('=', t.cloneNode(target), value))
  return seqWithFinal(expr, build)
}
