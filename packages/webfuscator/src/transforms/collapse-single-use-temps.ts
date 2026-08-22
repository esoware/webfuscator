import traverse from '@babel/traverse'
import type { Binding, NodePath, Scope } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { evaluateConstant } from '../analysis/constant'
import {
  declarationReaches,
  initializerReaches,
  readCrossesFunctionBoundary,
} from '../analysis/document-order'
import { isPure } from '../analysis/purity'
import { isInsideWith } from '../utils/ast'
import { reorderableToStatement } from '../utils/evaluation-order'
import { valueToLiteral } from '../utils/literal'
import { isCalleeOrTagOf } from '../utils/paths'

/**
 * Drops single-use temporaries through substitution, direct branch writes, or
 * constant replacement. Sweeps continue until no shape exposes another.
 *
 * @example
 * // ◀️ before
 * var _t;
 * if (cond) { _t = 1; } else { _t = 2; }
 * return _t;
 *
 * // ▶️ after
 * if (cond) { return 1; } else { return 2; }
 */
export function collapseSingleUseTemps(ast: File): boolean {
  let anyChanged = false
  for (let pass = 0; pass < 20; pass++) {
    const programScope = findProgramScope(ast)
    if (!programScope) {
      return anyChanged
    }
    programScope.crawl()

    const candidates: NodePath<t.VariableDeclarator>[] = []
    traverse(ast, {
      VariableDeclarator(path) {
        if (resolveSingleUseBinding(path)) {
          candidates.push(path)
        }
      },
    })

    let changedThisPass = false
    for (const candidate of candidates) {
      if (candidate.removed) {
        continue
      }
      // Earlier rewrites can invalidate bindings collected by this sweep.
      const binding = resolveSingleUseBinding(candidate)
      if (!binding) {
        continue
      }

      if (
        binding.references === 1 &&
        (trySubstituteSingleUse(binding, candidate) ||
          tryRenameWritesToReader(binding, candidate) ||
          tryScatterIntoTerminator(binding, candidate))
      ) {
        changedThisPass = true
        continue
      }
      if (tryPropagateConstant(binding, candidate)) {
        changedThisPass = true
      }
    }

    if (!changedThisPass) {
      break
    }
    anyChanged = true
  }
  return anyChanged
}

// Holes, patterns, dead bindings, and rebound names have no usable binding.
function resolveSingleUseBinding(path: NodePath<t.VariableDeclarator>): Binding | null {
  if (!t.isIdentifier(path.node.id)) {
    return null
  }
  const binding = path.scope.getBinding(path.node.id.name)
  if (!binding || binding.path.node !== path.node) {
    return null
  }
  if (binding.kind !== 'var' && binding.kind !== 'let' && binding.kind !== 'const') {
    return null
  }
  if (binding.references === 0) {
    return null
  }
  // `with` can redirect the temporary or its consumer outside Babel's scope table.
  if (bindingTouchesWith(binding)) {
    return null
  }
  return binding
}

function bindingTouchesWith(binding: Binding): boolean {
  return (
    isInsideWith(binding.path) ||
    binding.referencePaths.some((ref) => isInsideWith(ref)) ||
    binding.constantViolations.some((violation) => isInsideWith(violation))
  )
}

function findProgramScope(ast: File): Scope | undefined {
  let result: Scope | undefined
  traverse(ast, {
    Program(path) {
      result = path.scope
      path.stop()
    },
  })
  return result
}

// Move a single initializer into its later read when the span is safe.
function trySubstituteSingleUse(
  binding: Binding,
  declaratorPath: NodePath<t.VariableDeclarator>,
): boolean {
  const readPath = binding.referencePaths[0]
  if (!readPath || !isPathLive(readPath)) {
    return false
  }

  const declStmt = declaratorPath.parentPath
  if (!declStmt || !declStmt.isVariableDeclaration()) {
    return false
  }
  if (declStmt.node.declarations.length !== 1) {
    return false
  }

  const init = declaratorPath.node.init
  let writeStmt: NodePath
  let writeValueOwner: NodePath
  let writeRhs: t.Expression
  let removeWriteStmt: boolean

  if (init) {
    if (binding.constantViolations.length > 0) {
      return false
    }
    writeStmt = declStmt
    writeValueOwner = declaratorPath.get('init') as NodePath
    writeRhs = init
    removeWriteStmt = false
  } else {
    if (binding.constantViolations.length !== 1) {
      return false
    }
    const violation = binding.constantViolations[0]!
    if (!violation.isAssignmentExpression() || violation.node.operator !== '=') {
      return false
    }
    if (
      !t.isIdentifier(violation.node.left) ||
      violation.node.left.name !== binding.identifier.name
    ) {
      return false
    }
    if (!violation.parentPath?.isExpressionStatement()) {
      return false
    }
    if (violation.parentPath.node.expression !== violation.node) {
      return false
    }
    writeStmt = violation.parentPath
    writeValueOwner = violation.get('right') as NodePath
    writeRhs = violation.node.right
    removeWriteStmt = true
  }

  const readStmt = safeGetStatementParent(readPath)
  if (!readStmt) {
    return false
  }

  // The read must be unconditional and have no earlier observable work.
  if (!reorderableToStatement(readPath, readStmt)) {
    return false
  }
  // Moving into a loop header would repeat evaluation.
  if (readIsInLoopHeader(readPath, readStmt)) {
    return false
  }
  // Substituting a member into callee position would bind its receiver as `this`.
  if (
    isCalleeOrTagOf(readPath) &&
    (t.isMemberExpression(writeRhs) || t.isOptionalMemberExpression(writeRhs))
  ) {
    return false
  }

  const container = writeStmt.parentPath
  if (!container) {
    return false
  }
  if (readStmt.parentPath !== container) {
    return false
  }

  const stmtPaths = getContainerStatementPaths(container)
  if (!stmtPaths) {
    return false
  }
  const writeIdx = stmtPaths.findIndex((stmt) => stmt.node === writeStmt.node)
  const readIdx = stmtPaths.findIndex((stmt) => stmt.node === readStmt.node)
  if (writeIdx === -1 || readIdx === -1) {
    return false
  }
  if (writeIdx >= readIdx) {
    return false
  }

  if (writeIdx + 1 < readIdx) {
    // Moving across a statement requires pure code and no intervening declaration.
    if (!writeValueOwner.isPure()) {
      return false
    }
    for (let i = writeIdx + 1; i < readIdx; i++) {
      const stmtPath = stmtPaths[i]
      if (!stmtPath || !isStatementMovementSafe(stmtPath)) {
        return false
      }
    }
  }

  readPath.replaceWith(t.cloneNode(writeRhs))

  if (removeWriteStmt) {
    writeStmt.remove()
  }
  declStmt.remove()

  return true
}

// Redirect scattered temporary writes into their final consumer.
function tryRenameWritesToReader(
  binding: Binding,
  declaratorPath: NodePath<t.VariableDeclarator>,
): boolean {
  if (declaratorPath.node.init !== null) {
    return false
  }
  if (binding.constantViolations.length === 0) {
    return false
  }

  const readPath = binding.referencePaths[0]
  if (!readPath || !isPathLive(readPath)) {
    return false
  }

  const readParent = readPath.parentPath
  if (
    !readParent?.isAssignmentExpression() ||
    readParent.node.operator !== '=' ||
    readParent.node.right !== readPath.node ||
    !t.isIdentifier(readParent.node.left)
  ) {
    return false
  }

  const readStmt = readParent.parentPath
  if (!readStmt?.isExpressionStatement() || readStmt.node.expression !== readParent.node) {
    return false
  }

  const yIdent = readParent.node.left
  const yBinding = readParent.scope.getBinding(yIdent.name)
  if (!yBinding) {
    return false
  }

  const declStmt = declaratorPath.parentPath
  if (!declStmt?.isVariableDeclaration()) {
    return false
  }
  if (declStmt.node.declarations.length !== 1) {
    return false
  }

  const container = declStmt.parentPath
  if (!container || readStmt.parentPath !== container) {
    return false
  }

  const stmtPaths = getContainerStatementPaths(container)
  if (!stmtPaths) {
    return false
  }
  const declIdx = stmtPaths.findIndex((stmt) => stmt.node === declStmt.node)
  const readIdx = stmtPaths.findIndex((stmt) => stmt.node === readStmt.node)
  if (declIdx === -1 || readIdx === -1) {
    return false
  }
  if (declIdx >= readIdx) {
    return false
  }

  for (const violation of binding.constantViolations) {
    if (!violation.isAssignmentExpression() || violation.node.operator !== '=') {
      return false
    }
    if (
      !t.isIdentifier(violation.node.left) ||
      violation.node.left.name !== binding.identifier.name
    ) {
      return false
    }
    if (!violation.parentPath?.isExpressionStatement()) {
      return false
    }

    const stmtAncestorIdx = ancestorIndexInContainer(violation, container, stmtPaths)
    if (stmtAncestorIdx === -1) {
      return false
    }
    if (stmtAncestorIdx <= declIdx || stmtAncestorIdx >= readIdx) {
      return false
    }

    if (violation.scope.getBinding(yIdent.name) !== yBinding) {
      return false
    }

    // Redirecting into a later lexical binding could write it in TDZ.
    if (!declarationReaches(yBinding.path, violation)) {
      return false
    }
  }

  const spanPaths: NodePath[] = []
  for (let i = declIdx + 1; i < readIdx; i++) {
    const stmtPath = stmtPaths[i]
    if (!stmtPath || !stmtPath.node) {
      return false
    }
    spanPaths.push(stmtPath)
  }

  // Every path reaching the consumer must assign the temporary first.
  if (!spanDefinitelyAssigns(binding, spanPaths)) {
    return false
  }

  for (const stmtPath of spanPaths) {
    // Redirected writes make the consumer value visible earlier.
    if (subtreeReadsBinding(stmtPath, yBinding)) {
      return false
    }
    // Other work in the span could observe the earlier consumer writes.
    if (!spanStatementIsInert(stmtPath, binding)) {
      return false
    }
  }

  for (const violation of binding.constantViolations) {
    if (!t.isAssignmentExpression(violation.node)) {
      continue
    }
    ;(violation.node.left as t.Identifier).name = yIdent.name
  }

  declStmt.remove()
  readStmt.remove()

  return true
}

// Replace branch-tail writes followed by a terminator with direct terminators.
function tryScatterIntoTerminator(
  binding: Binding,
  declaratorPath: NodePath<t.VariableDeclarator>,
): boolean {
  if (declaratorPath.node.init !== null) {
    return false
  }
  if (binding.constantViolations.length === 0) {
    return false
  }

  const readPath = binding.referencePaths[0]
  if (!readPath || !isPathLive(readPath)) {
    return false
  }

  const readParent = readPath.parentPath
  if (!readParent) {
    return false
  }

  const isReturn = readParent.isReturnStatement() && readParent.node.argument === readPath.node
  const isThrow = readParent.isThrowStatement() && readParent.node.argument === readPath.node
  if (!isReturn && !isThrow) {
    return false
  }

  const declStmt = declaratorPath.parentPath
  if (!declStmt?.isVariableDeclaration()) {
    return false
  }
  if (declStmt.node.declarations.length !== 1) {
    return false
  }

  const container = declStmt.parentPath
  if (!container || readParent.parentPath !== container) {
    return false
  }

  const stmtPaths = getContainerStatementPaths(container)
  if (!stmtPaths) {
    return false
  }
  const declIdx = stmtPaths.findIndex((stmt) => stmt.node === declStmt.node)
  const readIdx = stmtPaths.findIndex((stmt) => stmt.node === readParent.node)
  if (declIdx === -1 || readIdx === -1) {
    return false
  }
  if (declIdx >= readIdx) {
    return false
  }
  // Intervening statements would be skipped by direct branch terminators.
  if (declIdx + 1 >= readIdx) {
    return false
  }

  const scatterIdx = readIdx - 1
  const scatterStmt = stmtPaths[scatterIdx]!.node as t.Statement
  const writeOwners = collectScatterWriteOwners(binding, scatterStmt)
  if (!writeOwners) {
    return false
  }

  // Uncollected writes would survive after the binding is removed.
  if (writeOwners.length !== binding.constantViolations.length) {
    return false
  }
  const violationNodes = new Set(binding.constantViolations.map((violation) => violation.node))
  for (const owner of writeOwners) {
    if (!violationNodes.has(owner.exprStatement.expression)) {
      return false
    }
  }

  // Earlier statements stay in place and must not observe the temporary.
  for (let i = declIdx + 1; i < scatterIdx; i++) {
    const stmtPath = stmtPaths[i]
    if (!stmtPath) {
      return false
    }
    if (subtreeReadsBinding(stmtPath, binding)) {
      return false
    }
  }

  const build = isReturn
    ? (value: t.Expression): t.Statement => t.returnStatement(value)
    : (value: t.Expression): t.Statement => t.throwStatement(value)

  for (const owner of writeOwners) {
    const value = (owner.exprStatement.expression as t.AssignmentExpression).right
    owner.replaceInBlock(build(value))
  }

  declStmt.remove()
  readParent.remove()
  return true
}

interface ScatterWriteOwner {
  exprStatement: t.ExpressionStatement
  replaceInBlock: (stmt: t.Statement) => void
}

// Every branch must end with a matching temporary write.
function collectScatterWriteOwners(
  binding: Binding,
  stmt: t.Statement,
): ScatterWriteOwner[] | null {
  const owners: ScatterWriteOwner[] = []
  if (!collectFromBranch(binding, stmt, owners)) {
    return null
  }
  return owners.length > 0 ? owners : null
}

function collectFromBranch(
  binding: Binding,
  stmt: t.Statement,
  owners: ScatterWriteOwner[],
): boolean {
  if (t.isIfStatement(stmt)) {
    if (!stmt.alternate) {
      return false
    }
    return (
      collectFromBranch(binding, stmt.consequent, owners) &&
      collectFromBranch(binding, stmt.alternate, owners)
    )
  }
  if (t.isBlockStatement(stmt)) {
    if (stmt.body.length === 0) {
      return false
    }
    const last = stmt.body.at(-1)!
    if (isWriteToBinding(binding, last)) {
      owners.push({
        exprStatement: last as t.ExpressionStatement,
        replaceInBlock(replacement) {
          stmt.body[stmt.body.length - 1] = replacement
        },
      })
      return true
    }
    return collectFromBranch(binding, last, owners)
  }
  if (isWriteToBinding(binding, stmt)) {
    // A bare branch write needs a parent-aware replacement this helper lacks.
    return false
  }
  return false
}

// `fall` tracks assignment on normal completion. `null` means control cannot
// fall through. Each abrupt exit records whether assignment happened first.
interface AssignFlow {
  fall: boolean | null
  escapes: {
    label: string | null
    kind: 'break' | 'continue' | 'return' | 'throw'
    assigned: boolean
  }[]
}

// Every path to the trailing read must assign first. Any abrupt exit can expose a
// redirected write elsewhere and is refused.
function spanDefinitelyAssigns(binding: Binding, spanPaths: NodePath[]): boolean {
  const flow = analyzeStatementList(
    binding,
    spanPaths.map((path) => path.node as t.Statement),
    false,
  )
  return flow.escapes.length === 0 && flow.fall === true
}

function analyzeStatementList(
  binding: Binding,
  statements: t.Statement[],
  entry: boolean,
): AssignFlow {
  let cur: boolean | null = entry
  const escapes: AssignFlow['escapes'] = []
  for (const statement of statements) {
    if (cur === null) {
      // An unconditional exit makes the remaining statements unreachable.
      break
    }
    const flow = analyzeStatement(binding, statement, cur)
    escapes.push(...flow.escapes)
    cur = flow.fall
  }
  return { fall: cur, escapes }
}

function analyzeStatement(binding: Binding, stmt: t.Statement, entry: boolean): AssignFlow {
  if (isWriteToBinding(binding, stmt)) {
    return { fall: true, escapes: [] }
  }
  if (
    t.isEmptyStatement(stmt) ||
    t.isExpressionStatement(stmt) ||
    t.isVariableDeclaration(stmt) ||
    t.isDebuggerStatement(stmt)
  ) {
    return { fall: entry, escapes: [] }
  }
  if (t.isBreakStatement(stmt)) {
    return {
      fall: null,
      escapes: [{ label: stmt.label?.name ?? null, kind: 'break', assigned: entry }],
    }
  }
  if (t.isContinueStatement(stmt)) {
    return {
      fall: null,
      escapes: [{ label: stmt.label?.name ?? null, kind: 'continue', assigned: entry }],
    }
  }
  if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) {
    const kind = t.isReturnStatement(stmt) ? 'return' : 'throw'
    return { fall: null, escapes: [{ label: null, kind, assigned: entry }] }
  }
  if (t.isBlockStatement(stmt)) {
    return analyzeStatementList(binding, stmt.body, entry)
  }
  if (t.isIfStatement(stmt)) {
    const consequent = analyzeStatement(binding, stmt.consequent, entry)
    const alternate = stmt.alternate
      ? analyzeStatement(binding, stmt.alternate, entry)
      : { fall: entry, escapes: [] as AssignFlow['escapes'] }
    return {
      fall: combineFall(consequent.fall, alternate.fall),
      escapes: [...consequent.escapes, ...alternate.escapes],
    }
  }
  if (t.isLabeledStatement(stmt)) {
    const inner = analyzeStatement(binding, stmt.body, entry)
    const label = stmt.label.name
    const remaining: AssignFlow['escapes'] = []
    const capturedFall: (boolean | null)[] = [inner.fall]
    for (const escape of inner.escapes) {
      if (escape.kind === 'break' && escape.label === label) {
        // A `break <thisLabel>` completes the labeled statement normally.
        capturedFall.push(escape.assigned)
      } else {
        remaining.push(escape)
      }
    }
    const fall = capturedFall.reduce<boolean | null>((acc, state) => combineFall(acc, state), null)
    return { fall, escapes: remaining }
  }
  // These containers are not proven to assign on every path.
  return { fall: false, escapes: [] }
}

// A non-falling branch defers to the other. Two falling branches must both assign.
function combineFall(a: boolean | null, b: boolean | null): boolean | null {
  if (a === null) {
    return b
  }
  if (b === null) {
    return a
  }
  return a && b
}

// Apart from redirected writes, the span must run no user code or observations.
// Redirected right sides must also be pure.
function spanStatementIsInert(path: NodePath, tempBinding: Binding): boolean {
  const node = path.node
  if (t.isEmptyStatement(node) || t.isBreakStatement(node) || t.isContinueStatement(node)) {
    return true
  }
  if (t.isBlockStatement(node)) {
    return (path.get('body') as NodePath[]).every((inner) =>
      spanStatementIsInert(inner, tempBinding),
    )
  }
  if (t.isLabeledStatement(node)) {
    return spanStatementIsInert(path.get('body') as NodePath, tempBinding)
  }
  if (t.isIfStatement(node)) {
    const test = path.get('test') as NodePath
    if (!isPure(test.node, test.scope, test)) {
      return false
    }
    if (!spanStatementIsInert(path.get('consequent') as NodePath, tempBinding)) {
      return false
    }
    const alternate = path.get('alternate') as NodePath
    return !alternate.node || spanStatementIsInert(alternate, tempBinding)
  }
  if (t.isExpressionStatement(node)) {
    const expr = path.get('expression') as NodePath
    if (isTempWrite(expr.node, tempBinding)) {
      const rhs = expr.get('right') as NodePath
      return isPure(rhs.node, rhs.scope, rhs)
    }
    return isPure(expr.node, expr.scope, expr)
  }
  return false
}

function isTempWrite(node: t.Node, tempBinding: Binding): boolean {
  return (
    t.isAssignmentExpression(node) &&
    node.operator === '=' &&
    t.isIdentifier(node.left) &&
    node.left.name === tempBinding.identifier.name
  )
}

function isWriteToBinding(binding: Binding, stmt: t.Statement): boolean {
  if (!t.isExpressionStatement(stmt)) {
    return false
  }
  const expr = stmt.expression
  if (!t.isAssignmentExpression(expr) || expr.operator !== '=') {
    return false
  }
  if (!t.isIdentifier(expr.left) || expr.left.name !== binding.identifier.name) {
    return false
  }
  return true
}

// A known single-write value can replace reads only after an unconditional write.
function tryPropagateConstant(
  binding: Binding,
  declaratorPath: NodePath<t.VariableDeclarator>,
): boolean {
  const declStmt = declaratorPath.parentPath
  if (!declStmt || !declStmt.isVariableDeclaration()) {
    return false
  }

  const init = declaratorPath.node.init
  let writeRhs: t.Expression
  let writeRhsPath: NodePath
  let writeStmtToRemove: NodePath | null
  let evalScope: Scope
  let writeSourcePath: NodePath

  if (init) {
    if (binding.constantViolations.length > 0) {
      return false
    }
    if (!isUnconditionallyExecuted(declStmt, declaratorPath.scope)) {
      return false
    }
    writeRhs = init
    writeRhsPath = declaratorPath.get('init') as NodePath
    writeStmtToRemove = null
    evalScope = declaratorPath.scope
    writeSourcePath = declaratorPath
  } else {
    if (binding.constantViolations.length !== 1) {
      return false
    }
    const violation = binding.constantViolations[0]!
    if (!violation.isAssignmentExpression() || violation.node.operator !== '=') {
      return false
    }
    if (
      !t.isIdentifier(violation.node.left) ||
      violation.node.left.name !== binding.identifier.name
    ) {
      return false
    }
    if (!violation.parentPath?.isExpressionStatement()) {
      return false
    }
    if (violation.parentPath.node.expression !== violation.node) {
      return false
    }
    if (
      violation.scope.getFunctionParent() !== declaratorPath.scope.getFunctionParent() ||
      violation.scope.getProgramParent() !== declaratorPath.scope.getProgramParent()
    ) {
      return false
    }
    if (!isUnconditionallyExecuted(violation.parentPath, declaratorPath.scope)) {
      return false
    }
    writeRhs = violation.node.right
    writeRhsPath = violation.get('right') as NodePath
    writeStmtToRemove = violation.parentPath
    evalScope = violation.scope
    writeSourcePath = violation
  }

  const evaluation = evaluateConstant(writeRhs, evalScope, writeRhsPath)
  if (!evaluation.known) {
    return false
  }

  const literal = valueToLiteral(evaluation.value)
  if (!literal) {
    return false
  }

  for (const ref of binding.referencePaths) {
    // A read before the write still sees `undefined`.
    if (!isPathLive(ref) || !initializerReaches(writeSourcePath, ref)) {
      return false
    }
    // A nested function can run before the declarator despite document order.
    if (readCrossesFunctionBoundary(binding, ref)) {
      return false
    }
  }
  for (const ref of binding.referencePaths) {
    ref.replaceWith(t.cloneNode(literal))
  }

  if (writeStmtToRemove) {
    writeStmtToRemove.remove()
  }
  if (declStmt.node.declarations.length === 1) {
    declStmt.remove()
  } else {
    declaratorPath.remove()
  }

  return true
}

// The write must sit only inside unconditional blocks before reaching its
// function or program. Any other container may leave the binding `undefined`.
function isUnconditionallyExecuted(stmtPath: NodePath, declScope: Scope): boolean {
  const declFnScope = declScope.getFunctionParent()
  let current: NodePath = stmtPath
  while (current.parentPath) {
    const parent: NodePath = current.parentPath
    if (parent.isFunction()) {
      return parent.scope === declFnScope
    }
    if (parent.isProgram()) {
      return declFnScope === null || declFnScope === undefined
    }
    if (!parent.isBlockStatement()) {
      return false
    }
    current = parent
  }
  return false
}

function ancestorIndexInContainer(
  path: NodePath,
  container: NodePath,
  stmtPaths: NodePath[],
): number {
  let current: NodePath = path
  while (current.parentPath && current.parentPath !== container) {
    current = current.parentPath
  }
  if (!current.parentPath || current.parentPath !== container) {
    return -1
  }
  return stmtPaths.findIndex((stmt) => stmt.node === current.node)
}

// Stale paths may have no statement ancestor, where Babel's helper throws.
function safeGetStatementParent(path: NodePath): NodePath | null {
  let current: NodePath | null = path
  while (current) {
    if (current.isStatement()) {
      return current
    }
    if (!current.parentPath) {
      return null
    }
    current = current.parentPath
  }
  return null
}

function subtreeReadsBinding(stmtPath: NodePath, target: Binding): boolean {
  let found = false
  const visitor = {
    Identifier(path: NodePath<t.Identifier>) {
      if (path.node.name !== target.identifier.name) {
        return
      }
      if (!path.isReferencedIdentifier()) {
        return
      }
      if (path.scope.getBinding(path.node.name) !== target) {
        return
      }
      found = true
      path.stop()
    },
  }
  if (
    stmtPath.isReferencedIdentifier() &&
    (stmtPath.node as t.Identifier).name === target.identifier.name &&
    stmtPath.scope.getBinding((stmtPath.node as t.Identifier).name) === target
  ) {
    return true
  }
  stmtPath.traverse(visitor)
  return found
}

function isStatementMovementSafe(path: NodePath): boolean {
  const node = path.node
  if (t.isEmptyStatement(node)) {
    return true
  }
  // Crossing a declaration can change name resolution or TDZ.
  if (t.isExpressionStatement(node)) {
    const expr = path.get('expression') as NodePath
    return isPure(expr.node, expr.scope, expr)
  }
  return false
}

// Callers locate and index statements within this same path array.
function getContainerStatementPaths(container: NodePath): NodePath[] | null {
  if (container.isBlock()) {
    return container.get('body') as NodePath[]
  }
  if (container.isSwitchCase()) {
    return container.get('consequent') as NodePath[]
  }
  return null
}

// Loop tests, updates, and iterator targets repeat each iteration.
function readIsInLoopHeader(readPath: NodePath, readStmt: NodePath): boolean {
  if (
    !readStmt.isForStatement() &&
    !readStmt.isWhileStatement() &&
    !readStmt.isDoWhileStatement() &&
    !readStmt.isForInStatement() &&
    !readStmt.isForOfStatement()
  ) {
    return false
  }
  let ancestor: NodePath | null = readPath
  while (ancestor && ancestor.parentPath !== readStmt) {
    ancestor = ancestor.parentPath
  }
  if (!ancestor) {
    return false
  }
  if (readStmt.isForStatement()) {
    return ancestor.parentKey === 'test' || ancestor.parentKey === 'update'
  }
  if (readStmt.isForInStatement() || readStmt.isForOfStatement()) {
    // The iterable runs once. Only the target repeats.
    return ancestor.parentKey === 'left'
  }
  return ancestor.parentKey === 'test'
}

// Babel marks only the directly removed path. A live descendant must still reach
// the Program through parents that were not removed.
function isPathLive(path: NodePath): boolean {
  if (path.removed || path.node == null) {
    return false
  }
  let current: NodePath | null = path
  while (current) {
    if (current.removed) {
      return false
    }
    if (current.isProgram()) {
      return true
    }
    current = current.parentPath
  }
  return false
}
