import traverse from '@babel/traverse'
import type { NodePath, Scope } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { analyzeInlineability } from 'src/analysis/inlineability'
import type { InlineCandidate } from 'src/analysis/inlineability'
import { isPure } from 'src/analysis/purity'
import { enclosingScopeHasDirectEval, isInsideWith, walkOwnFunctionScope } from 'src/utils/ast'
import { reorderableToStatement } from 'src/utils/evaluation-order'
import { generateLoopLabel } from 'src/utils/loop-lowering'
import { hasAnnexBFunctionAlias, isInStrictContext } from 'src/utils/paths'

/**
 * Replaces eligible calls with function bodies, working from inner calls out.
 * Declarations are removed after their last reference disappears.
 *
 * @example
 * // ◀️ before
 * function id(x) { return x; }
 * var y = id(compute());
 *
 * // ▶️ after
 * var _x = compute();
 * var y = _x;
 */
export function inlineFunctions(ast: File): boolean {
  const candidates = analyzeInlineability(ast)
  if (candidates.size === 0) {
    return false
  }

  let anyInlined = false

  traverse(ast, {
    CallExpression: {
      exit(path) {
        // Direct statement-array edits bypass Babel's binding updates. Crawl the
        // owner so later sibling calls see new initialized temps in this pass.
        const tempOwner = path.getFunctionParent() ?? path.scope.getProgramParent().path
        if (tryInlineAtCallExpr(path, candidates)) {
          anyInlined = true
          tempOwner.scope.crawl()
          rebindCandidates(candidates)
        }
      },
    },
  })

  if (!anyInlined) {
    return false
  }

  dropZeroRefCandidates(candidates)
  return true
}

function tryInlineAtCallExpr(
  path: NodePath<t.CallExpression>,
  candidates: Map<string, InlineCandidate>,
): boolean {
  const { callee } = path.node
  if (!t.isIdentifier(callee)) {
    return false
  }
  const candidate = candidates.get(callee.name)
  if (!candidate) {
    return false
  }
  const binding = path.scope.getBinding(callee.name)
  if (!binding || binding !== candidate.binding) {
    return false
  }
  // Earlier inlining can add free references to this candidate's live body.
  const freeVars = computeLiveFreeVars(candidate)
  if (!isSafeAtCallSite(candidate, freeVars, path, candidates)) {
    return false
  }
  return inlineCallSite(path, candidate, freeVars)
}

// A crawl replaces Binding objects. Re-resolve candidates from their declarations.
function rebindCandidates(candidates: Map<string, InlineCandidate>): void {
  for (const [name, candidate] of candidates) {
    const declId = declarationIdentifier(candidate.declarationPath)
    const binding = candidate.declarationPath.removed
      ? null
      : candidate.declarationPath.scope.getBinding(name)
    if (!binding || !declId || binding.identifier !== declId) {
      candidates.delete(name)
      continue
    }
    candidate.binding = binding
  }
}

function dropZeroRefCandidates(candidates: Map<string, InlineCandidate>): void {
  const first = candidates.values().next().value
  if (!first) {
    return
  }
  first.declarationPath.scope.getProgramParent().crawl()
  for (const candidate of candidates.values()) {
    const declPath = candidate.declarationPath
    if (declPath.removed) {
      continue
    }
    const declId = declarationIdentifier(declPath)
    if (!declId) {
      continue
    }
    // An outer same-named binding must not decide whether this declaration drops.
    const binding = declPath.scope.getBinding(candidate.name)
    if (!binding || binding.identifier !== declId || binding.references > 0) {
      continue
    }
    declPath.remove()
  }
}

function declarationIdentifier(declPath: NodePath): t.Identifier | null {
  if (declPath.isFunctionDeclaration()) {
    return declPath.node.id ?? null
  }
  if (declPath.isVariableDeclaration() && declPath.node.declarations.length === 1) {
    const { id } = declPath.node.declarations[0]!
    return t.isIdentifier(id) ? id : null
  }
  return null
}

function isSafeAtCallSite(
  candidate: InlineCandidate,
  freeVars: Set<string>,
  callPath: NodePath<t.CallExpression>,
  candidates: Map<string, InlineCandidate>,
): boolean {
  // `with`, direct eval, and Annex B aliases can redirect free names outside
  // Babel's scope table.
  if (isInsideWith(callPath) || enclosingScopeHasDirectEval(callPath)) {
    return false
  }
  if (annexBHoistShadowsFreeVar(callPath, freeVars)) {
    return false
  }
  // Spliced code inherits call-site strictness, so it must match the callee.
  if (isInStrictContext(candidate.fnPath) !== isInStrictContext(callPath)) {
    return false
  }
  // In a loop, spliced uninitialized `var` bindings would retain prior values.
  if (
    callIsInsideLoop(callPath) &&
    bodyHasUninitializedVar(candidate.fnNode.body as t.BlockStatement)
  ) {
    return false
  }

  for (const freeVar of freeVars) {
    const declSiteBinding = candidate.fnPath.scope.parent?.getBinding(freeVar)
    const callSiteBinding = callPath.scope.getBinding(freeVar)
    if (declSiteBinding !== callSiteBinding) {
      return false
    }
  }

  if (isInUnsafeExpressionPosition(callPath)) {
    return false
  }

  const stmtParent = callPath.getStatementParent()
  if (!stmtParent) {
    return false
  }
  // The call must run exactly once at statement position. Repeating loop slots,
  // short-circuiting chains, case tests, and earlier effects are refused.
  if (stmtParent.isLoop() && callInReevaluatedLoopPosition(callPath, stmtParent)) {
    return false
  }
  if (withinOptionalChain(callPath, stmtParent)) {
    return false
  }
  if (!reorderableToStatement(callPath, stmtParent)) {
    return false
  }

  if (argsContainContextExpression(callPath)) {
    return false
  }
  if (argsContainCandidateCalls(callPath, candidates)) {
    return false
  }

  return true
}

// ECMA-262 B.3.2.1 creates a sloppy block-function alias that Babel misses in
// the enclosing scope.
function annexBHoistShadowsFreeVar(
  callPath: NodePath<t.CallExpression>,
  freeVars: Set<string>,
): boolean {
  if (freeVars.size === 0 || isInStrictContext(callPath)) {
    return false
  }
  const owner = callPath.getFunctionParent() ?? callPath.scope.getProgramParent().path
  let found = false
  owner.traverse({
    Function(path) {
      path.skip()
    },
    FunctionDeclaration(path) {
      const { id } = path.node
      if (id && freeVars.has(id.name) && hasAnnexBFunctionAlias(path)) {
        found = true
        path.stop()
      }
    },
  })
  return found
}

// Only loops in the same function repeat the spliced body.
function callIsInsideLoop(callPath: NodePath): boolean {
  for (let current: NodePath | null = callPath.parentPath; current; current = current.parentPath) {
    if (current.isLoop()) {
      return true
    }
    if (current.isFunction() || current.isProgram()) {
      return false
    }
  }
  return false
}

function bodyHasUninitializedVar(body: t.BlockStatement): boolean {
  let found = false
  walkOwnFunctionScope(body, (node) => {
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id) && node.init == null) {
      found = true
    }
  })
  return found
}

function bodyHasTryFinally(body: t.BlockStatement): boolean {
  let found = false
  walkOwnFunctionScope(body, (node) => {
    if (t.isTryStatement(node) && node.finalizer != null) {
      found = true
    }
  })
  return found
}

// Loop tests and updates repeat. Initializers and iterator sources run once.
function callInReevaluatedLoopPosition(callPath: NodePath, loopPath: NodePath): boolean {
  let cur: NodePath = callPath
  while (cur.parentPath && cur.parentPath !== loopPath) {
    cur = cur.parentPath
  }
  if (loopPath.isForStatement()) {
    return cur.key !== 'init'
  }
  if (loopPath.isForInStatement() || loopPath.isForOfStatement()) {
    return cur.key !== 'right'
  }
  return true
}

// Any optional ancestor may short-circuit the call.
function withinOptionalChain(callPath: NodePath, stmtParent: NodePath): boolean {
  let cur: NodePath = callPath
  for (;;) {
    const parent = cur.parentPath
    if (!parent || parent === stmtParent) {
      return false
    }
    if (parent.isOptionalMemberExpression() || parent.isOptionalCallExpression()) {
      return true
    }
    cur = parent
  }
}

function argsContainContextExpression(callPath: NodePath<t.CallExpression>): boolean {
  const stmtParent = callPath.getStatementParent()
  if (!stmtParent) {
    return false
  }

  if (
    callPath.parentPath === stmtParent ||
    (callPath.parentPath?.isExpressionStatement() && callPath.parentPath === stmtParent)
  ) {
    return false
  }

  for (const arg of callPath.node.arguments) {
    if (containsThisOrArguments(arg)) {
      return true
    }
  }
  return false
}

function containsThisOrArguments(node: t.Node): boolean {
  let found = false
  t.traverseFast(node, (visited) => {
    // Non-arrow functions bind their own `this` and `arguments`.
    if (t.isFunction(visited) && !t.isArrowFunctionExpression(visited)) {
      return t.traverseFast.skip
    }
    const isContextRef =
      t.isThisExpression(visited) || (t.isIdentifier(visited) && visited.name === 'arguments')
    if (isContextRef) {
      found = true
    }
    return isContextRef ? t.traverseFast.stop : undefined
  })
  return found
}

function argsContainCandidateCalls(
  callPath: NodePath<t.CallExpression>,
  candidates: Map<string, InlineCandidate>,
): boolean {
  for (const arg of callPath.node.arguments) {
    if (containsCandidateCall(arg, candidates)) {
      return true
    }
  }
  return false
}

function containsCandidateCall(node: t.Node, candidates: Map<string, InlineCandidate>): boolean {
  let found = false
  t.traverseFast(node, (visited) => {
    const isCandidateCall =
      t.isCallExpression(visited) &&
      t.isIdentifier(visited.callee) &&
      candidates.has(visited.callee.name)
    if (isCandidateCall) {
      found = true
    }
    return isCandidateCall ? t.traverseFast.stop : undefined
  })
  return found
}

function isInUnsafeExpressionPosition(path: NodePath): boolean {
  let current: NodePath = path
  while (current.parentPath) {
    const parent = current.parentPath
    if (parent.isStatement()) {
      return false
    }

    if (
      parent.isConditionalExpression() &&
      (current.key === 'consequent' || current.key === 'alternate')
    ) {
      return true
    }
    if (parent.isLogicalExpression() && current.key === 'right') {
      return true
    }
    if (
      parent.isSequenceExpression() &&
      parent.node.expressions.indexOf(current.node as t.Expression) > 0
    ) {
      return true
    }
    // Default values run per call in the function's parameter scope.
    if (parent.isAssignmentPattern() && current.key === 'right') {
      return true
    }
    // Logical-assignment right sides are conditional.
    if (
      parent.isAssignmentExpression() &&
      current.key === 'right' &&
      (parent.node.operator === '||=' ||
        parent.node.operator === '&&=' ||
        parent.node.operator === '??=')
    ) {
      return true
    }

    current = parent
  }
  return false
}

function getReturnPattern(stmts: t.Statement[]): 'none' | 'trailing' | 'complex' {
  if (stmts.length === 0) {
    return 'none'
  }
  for (let i = 0; i < stmts.length - 1; i++) {
    if (containsReturn(stmts[i]!)) {
      return 'complex'
    }
  }
  const last = stmts.at(-1)!
  if (t.isReturnStatement(last)) {
    return 'trailing'
  }
  if (containsReturn(last)) {
    return 'complex'
  }
  return 'none'
}

function containsReturn(node: t.Node): boolean {
  let found = false
  t.traverseFast(node, (visited) => {
    if (t.isFunction(visited) && visited !== node) {
      return t.traverseFast.skip
    }
    const isReturn = t.isReturnStatement(visited)
    if (isReturn) {
      found = true
    }
    return isReturn ? t.traverseFast.stop : undefined
  })
  return found
}

function inlineCallSite(
  callPath: NodePath<t.CallExpression>,
  candidate: InlineCandidate,
  freeVars: Set<string>,
): boolean {
  if (callPath.removed) {
    return false
  }

  const args = callPath.node.arguments as t.Expression[]
  const argPaths = callPath.get('arguments') as NodePath<t.Expression>[]
  const body = candidate.fnNode.body as t.BlockStatement
  const returnPattern = getReturnPattern(body.body)

  const stmtParent = callPath.getStatementParent()
  if (!stmtParent) {
    return false
  }

  const containerPath = stmtParent.parentPath
  if (!containerPath) {
    return false
  }

  let containerArray: t.Statement[] | null = null
  if (containerPath.isBlock()) {
    containerArray = (containerPath.node as t.Block).body
  } else if (containerPath.isSwitchCase()) {
    containerArray = containerPath.node.consequent
  }
  if (!containerArray) {
    return false
  }

  const stmtIndex = containerArray.indexOf(stmtParent.node)
  if (stmtIndex === -1) {
    return false
  }

  const { scope } = stmtParent
  const labelName = generateLoopLabel(stmtParent, 'inlined')

  // Returns can write directly into a bare assignment or `var` initializer.
  // Hoisted `var` already defaults to `undefined`. A plain assignment is safe
  // only with one trailing return and no fall-through path.
  const trailingReturn =
    returnPattern === 'trailing' ? (body.body.at(-1) as t.ReturnStatement) : null
  const trailingReturnHasArgument = trailingReturn != null && trailingReturn.argument != null
  const rawTarget =
    returnPattern === 'none' ? null : identifyDirectAssignmentTarget(callPath, freeVars, args)
  // A finalizer runs before the call publishes its return value. Direct writes
  // inside its `try` would expose the value too early.
  const returnObservableByFinally = returnPattern === 'complex' && bodyHasTryFinally(body)
  const directTarget =
    rawTarget == null ||
    returnObservableByFinally ||
    (rawTarget.kind === 'assign' && !trailingReturnHasArgument)
      ? null
      : rawTarget
  const retVarName = directTarget ? directTarget.name : scope.generateUid('returnValue')

  const nameMap = new Map<string, string>()
  const elidedParams = new Set<string>()
  for (let i = 0; i < candidate.params.length; i++) {
    const param = candidate.params[i]!
    const argPath = i < args.length ? argPaths[i]! : null
    if (
      argPath &&
      argEligibleForElision(argPath, callPath.scope) &&
      !freeVars.has((argPath.node as t.Identifier).name) &&
      isParamReadOnly(candidate, param) &&
      // An elided parameter must not alias the target that receives return writes.
      (argPath.node as t.Identifier).name !== retVarName
    ) {
      nameMap.set(param, (argPath.node as t.Identifier).name)
      elidedParams.add(param)
    } else {
      nameMap.set(param, scope.generateUid(param))
    }
  }
  for (const name of collectFunctionScopedNames(body)) {
    if (!nameMap.has(name)) {
      nameMap.set(name, scope.generateUid(name))
    }
  }

  const labelMap = new Map<string, string>()
  collectLabels(body, labelMap, scope)

  // Each call site needs an independently renamed deep clone.
  const clonedBody = t.cloneNode(body, true).body

  for (const stmt of clonedBody) {
    renameInBody(stmt, nameMap)
  }
  for (const stmt of clonedBody) {
    renameLabelsInNode(stmt, labelMap)
  }

  let emittedAnyBreak = false
  if (returnPattern === 'complex') {
    walkStatementsMut(
      clonedBody,
      {
        onReturn(node, ctx) {
          // A bare return must overwrite any earlier return value with `undefined`.
          const argument = node.argument ?? t.unaryExpression('void', t.numericLiteral(0))
          const stmts: t.Statement[] = [
            t.expressionStatement(t.assignmentExpression('=', t.identifier(retVarName), argument)),
          ]
          if (!ctx.tailPosition) {
            stmts.push(t.breakStatement(t.identifier(labelName)))
            emittedAnyBreak = true
          }
          return stmts
        },
      },
      { insideNestedLoop: false, insideNestedSwitch: false, tailPosition: true },
    )
  } else if (returnPattern === 'trailing') {
    const lastIdx = clonedBody.length - 1
    const last = clonedBody[lastIdx]!
    if (t.isReturnStatement(last)) {
      if (last.argument) {
        clonedBody[lastIdx] = t.expressionStatement(
          t.assignmentExpression('=', t.identifier(retVarName), last.argument),
        )
      } else {
        clonedBody.splice(lastIdx, 1)
      }
    }
  }

  const paramAssignments: t.Statement[] = []
  for (let i = 0; i < candidate.params.length; i++) {
    if (elidedParams.has(candidate.params[i]!)) {
      continue
    }
    const newName = nameMap.get(candidate.params[i]!)!
    const argNode =
      i < args.length ? t.cloneNode(args[i]!) : t.unaryExpression('void', t.numericLiteral(0))
    paramAssignments.push(
      t.variableDeclaration('var', [t.variableDeclarator(t.identifier(newName), argNode)]),
    )
  }

  for (let i = candidate.params.length; i < args.length; i++) {
    paramAssignments.push(t.expressionStatement(t.cloneNode(args[i]!)))
  }

  // Only rewritten early returns need the labeled wrapper.
  const needsLabel = returnPattern === 'complex' && emittedAnyBreak

  if (directTarget) {
    const replacement: t.Statement[] = []
    if (directTarget.kind === 'declarator') {
      replacement.push(
        t.variableDeclaration('var', [t.variableDeclarator(t.identifier(directTarget.name))]),
      )
    }
    if (needsLabel) {
      replacement.push(
        t.labeledStatement(
          t.identifier(labelName),
          t.blockStatement([...paramAssignments, ...clonedBody]),
        ),
      )
    } else {
      replacement.push(...paramAssignments, ...clonedBody)
    }
    stmtParent.replaceWithMultiple(replacement)
    return true
  }

  if (needsLabel) {
    const retVarDecl = t.variableDeclaration('var', [
      t.variableDeclarator(t.identifier(retVarName)),
    ])
    const labeledBlock = t.labeledStatement(
      t.identifier(labelName),
      t.blockStatement([...paramAssignments, ...clonedBody]),
    )
    containerArray.splice(stmtIndex, 0, retVarDecl, labeledBlock)
    callPath.replaceWith(t.identifier(retVarName))
  } else if (returnPattern === 'none') {
    containerArray.splice(stmtIndex, 0, ...paramAssignments, ...clonedBody)
    callPath.replaceWith(t.unaryExpression('void', t.numericLiteral(0)))
  } else {
    const retVarDecl = t.variableDeclaration('var', [
      t.variableDeclarator(t.identifier(retVarName)),
    ])
    containerArray.splice(stmtIndex, 0, retVarDecl, ...paramAssignments, ...clonedBody)
    callPath.replaceWith(t.identifier(retVarName))
  }
  return true
}

type DirectTarget = { kind: 'declarator'; name: string } | { kind: 'assign'; name: string }

function identifyDirectAssignmentTarget(
  callPath: NodePath<t.CallExpression>,
  freeVars: Set<string>,
  args: t.Expression[],
): DirectTarget | null {
  const parent = callPath.parentPath
  if (!parent) {
    return null
  }

  if (
    parent.isVariableDeclarator() &&
    t.isIdentifier(parent.node.id) &&
    parent.node.init === callPath.node
  ) {
    const declPath = parent.parentPath
    if (!declPath || !declPath.isVariableDeclaration() || declPath.node.declarations.length !== 1) {
      return null
    }
    // Only `var` can become an uninitialized direct target without changing TDZ
    // or block scope.
    if (declPath.node.kind !== 'var') {
      return null
    }
    const owner = declPath.parentPath
    if (!owner) {
      return null
    }
    if (owner.isForStatement() && owner.node.init === declPath.node) {
      return null
    }
    if (owner.isForInStatement() && owner.node.left === declPath.node) {
      return null
    }
    if (owner.isForOfStatement() && owner.node.left === declPath.node) {
      return null
    }
    const { name } = parent.node.id
    if (freeVars.has(name)) {
      return null
    }
    if (argsContainIdentName(args, name)) {
      return null
    }
    return { kind: 'declarator', name }
  }

  if (
    parent.isAssignmentExpression() &&
    parent.node.operator === '=' &&
    t.isIdentifier(parent.node.left) &&
    parent.node.right === callPath.node
  ) {
    const stmt = parent.parentPath
    if (!stmt || !stmt.isExpressionStatement() || stmt.node.expression !== parent.node) {
      return null
    }
    const { name } = parent.node.left
    if (freeVars.has(name)) {
      return null
    }
    if (argsContainIdentName(args, name)) {
      return null
    }
    return { kind: 'assign', name }
  }

  return null
}

function argsContainIdentName(args: t.Expression[], name: string): boolean {
  for (const arg of args) {
    if (t.isIdentifier(arg) && arg.name === name) {
      return true
    }
  }
  return false
}

function isParamReadOnly(candidate: InlineCandidate, paramName: string): boolean {
  const binding = candidate.fnPath.scope.bindings[paramName]
  return !binding || binding.constantViolations.length === 0
}

// Eliding a parameter repeats the argument read at each use. The read must be
// pure and resolve to an invariant binding.
function argEligibleForElision(argPath: NodePath, scope: Scope): boolean {
  if (!argPath.isIdentifier()) {
    return false
  }
  const binding = scope.getBinding(argPath.node.name)
  if (!binding || binding.constantViolations.length > 0) {
    return false
  }
  return isPure(argPath.node, scope, argPath)
}

// Catch parameters stay scoped to their copied handlers. Counting them here
// would rename same-named free references outside the handler.
function collectFunctionScopedNames(body: t.Node): Set<string> {
  const names = new Set<string>()
  walkOwnFunctionScope(body, (node) => {
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
      names.add(node.id.name)
    }
  })
  return names
}

// Optional catch bindings contribute no names.
function catchParamNames(clause: t.CatchClause): Set<string> {
  if (!clause.param) {
    return new Set()
  }
  return new Set(Object.keys(t.getBindingIdentifiers(clause.param)))
}

// Nested functions do not contribute names to the current function scope.
function collectOwnScopeBindings(fn: t.Function): Set<string> {
  const declared = new Set<string>()
  for (const param of fn.params) {
    for (const name of Object.keys(t.getBindingIdentifiers(param))) {
      declared.add(name)
    }
  }
  if (t.isBlockStatement(fn.body)) {
    for (const name of collectFunctionScopedNames(fn.body)) {
      declared.add(name)
    }
  }
  return declared
}

// Recompute free names from the live body after earlier inlining. Conservative
// extras only add call-site identity checks.
function computeLiveFreeVars(candidate: InlineCandidate): Set<string> {
  const body = candidate.fnNode.body as t.BlockStatement
  const ownBound = collectOwnScopeBindings(candidate.fnNode)

  const free = new Set<string>()
  const shadows = new ShadowStack()

  t.traverse(body, {
    enter(node, ancestors) {
      if (t.isFunction(node)) {
        shadows.push(node, collectOwnScopeBindings(node))
        return
      }
      if (t.isCatchClause(node)) {
        shadows.push(node, catchParamNames(node))
        return
      }
      if (!t.isIdentifier(node)) {
        return
      }
      const slot = ancestors.at(-1)
      if (slot && isNonReferenceSlot(slot.node, slot.key)) {
        return
      }
      const { name } = node
      if (ownBound.has(name) || shadows.covers(name)) {
        return
      }
      free.add(name)
    },
    exit(node) {
      if (t.isFunction(node) || t.isCatchClause(node)) {
        shadows.pop(node)
      }
    },
  })
  return free
}

// Live shadow frames prevent renaming references owned by an inner binding.
class ShadowStack {
  private readonly counts = new Map<string, number>()
  private readonly framesByNode = new WeakMap<t.Node, Set<string>>()

  push(node: t.Node, names: Set<string>): void {
    if (names.size === 0) {
      return
    }
    this.framesByNode.set(node, names)
    for (const name of names) {
      this.counts.set(name, (this.counts.get(name) ?? 0) + 1)
    }
  }

  pop(node: t.Node): void {
    const names = this.framesByNode.get(node)
    if (!names) {
      return
    }
    this.framesByNode.delete(node)
    for (const name of names) {
      const count = this.counts.get(name)!
      if (count <= 1) {
        this.counts.delete(name)
      } else {
        this.counts.set(name, count - 1)
      }
    }
  }

  covers(name: string): boolean {
    return (this.counts.get(name) ?? 0) > 0
  }
}

function collectLabels(body: t.BlockStatement, labelMap: Map<string, string>, scope: Scope): void {
  walkOwnFunctionScope(body, (node) => {
    if (t.isLabeledStatement(node) && !labelMap.has(node.label.name)) {
      labelMap.set(node.label.name, scope.generateUid(node.label.name))
    }
  })
}

function renameLabelsInNode(node: t.Node, labelMap: Map<string, string>): void {
  if (t.isFunction(node)) {
    return
  }
  walkOwnFunctionScope(node, (visited) => {
    if (t.isLabeledStatement(visited) && labelMap.has(visited.label.name)) {
      visited.label = t.identifier(labelMap.get(visited.label.name)!)
    }
    if (t.isBreakStatement(visited) && visited.label && labelMap.has(visited.label.name)) {
      visited.label = t.identifier(labelMap.get(visited.label.name)!)
    }
    if (t.isContinueStatement(visited) && visited.label && labelMap.has(visited.label.name)) {
      visited.label = t.identifier(labelMap.get(visited.label.name)!)
    }
  })
}

// Rename the detached clone before splicing. Babel's scope renamer needs a live
// path, while splicing first would publish unrenamed hoisted variables.
function renameInBody(node: t.Node, nameMap: Map<string, string>): void {
  const shadows = new ShadowStack()

  t.traverse(node, {
    enter(visited, ancestors) {
      if (t.isFunction(visited)) {
        shadows.push(visited, mappedShadow(collectOwnScopeBindings(visited), nameMap))
        return
      }
      if (t.isCatchClause(visited)) {
        shadows.push(visited, mappedShadow(catchParamNames(visited), nameMap))
        return
      }
      if (!t.isIdentifier(visited)) {
        return
      }
      const mapped = nameMap.get(visited.name)
      if (mapped === undefined) {
        return
      }
      if (shadows.covers(visited.name)) {
        return
      }
      const slot = ancestors.at(-1)
      if (slot && isNonReferenceSlot(slot.node, slot.key)) {
        return
      }
      visited.name = mapped
    },
    exit(visited) {
      if (t.isFunction(visited) || t.isCatchClause(visited)) {
        shadows.pop(visited)
      }
    },
  })
}

// Only remapped names need shadow tracking.
function mappedShadow(names: Set<string>, nameMap: Map<string, string>): Set<string> {
  const introduced = new Set<string>()
  for (const name of names) {
    if (nameMap.has(name)) {
      introduced.add(name)
    }
  }
  return introduced
}

function isNonReferenceSlot(parent: t.Node, key: string): boolean {
  if (key === 'property' && t.isMemberExpression(parent) && !parent.computed) {
    return true
  }
  if (
    key === 'key' &&
    (t.isObjectProperty(parent) || t.isObjectMethod(parent) || t.isClassMethod(parent)) &&
    !(parent as t.ObjectProperty).computed
  ) {
    return true
  }
  if (
    key === 'label' &&
    (t.isLabeledStatement(parent) || t.isBreakStatement(parent) || t.isContinueStatement(parent))
  ) {
    return true
  }
  return false
}

interface StatementWalkContext {
  insideNestedLoop: boolean
  insideNestedSwitch: boolean
  // Tail position propagates through final blocks, branches, and labels. Try,
  // switch, loops, and `with` interrupt it because more code may run afterward.
  tailPosition: boolean
}

interface StatementWalkHooks {
  onContinue?: (node: t.ContinueStatement, ctx: StatementWalkContext) => t.Statement | null
  onBreak?: (node: t.BreakStatement, ctx: StatementWalkContext) => void
  onReturn?: (node: t.ReturnStatement, ctx: StatementWalkContext) => t.Statement[] | null
}

// Nested-function control flow belongs to that function.
function walkStatementsMut(
  stmts: t.Statement[],
  hooks: StatementWalkHooks,
  ctx?: StatementWalkContext,
): void {
  const context = ctx ?? {
    insideNestedLoop: false,
    insideNestedSwitch: false,
    tailPosition: false,
  }

  for (let index = 0; index < stmts.length; index++) {
    const stmt = stmts[index]!
    const isLast = index === stmts.length - 1
    const stmtCtx: StatementWalkContext = {
      ...context,
      tailPosition: context.tailPosition && isLast,
    }

    if (t.isContinueStatement(stmt) && hooks.onContinue) {
      const replacement = hooks.onContinue(stmt, stmtCtx)
      if (replacement) {
        stmts[index] = replacement
      }
      continue
    }

    if (t.isBreakStatement(stmt) && hooks.onBreak) {
      hooks.onBreak(stmt, stmtCtx)
      continue
    }

    if (t.isReturnStatement(stmt) && hooks.onReturn) {
      const replacement = hooks.onReturn(stmt, stmtCtx)
      if (replacement) {
        stmts.splice(index, 1, ...replacement)
        index += replacement.length - 1
      }
      continue
    }

    walkIntoCompound(stmt, hooks, stmtCtx)
  }
}

function walkIntoCompound(
  node: t.Statement,
  hooks: StatementWalkHooks,
  ctx: StatementWalkContext,
): void {
  if (t.isBlockStatement(node)) {
    walkStatementsMut(node.body, hooks, ctx)
    return
  }

  if (t.isIfStatement(node)) {
    node.consequent = walkSingleChild(node.consequent, hooks, ctx)
    if (node.alternate) {
      node.alternate = walkSingleChild(node.alternate, hooks, ctx)
    }
    return
  }

  if (t.isLabeledStatement(node)) {
    node.body = walkSingleChild(node.body, hooks, ctx)
    return
  }

  if (t.isTryStatement(node)) {
    const inner: StatementWalkContext = { ...ctx, tailPosition: false }
    walkStatementsMut(node.block.body, hooks, inner)
    if (node.handler) {
      walkStatementsMut(node.handler.body.body, hooks, inner)
    }
    if (node.finalizer) {
      walkStatementsMut(node.finalizer.body, hooks, inner)
    }
    return
  }

  if (t.isSwitchStatement(node)) {
    const inner: StatementWalkContext = {
      ...ctx,
      insideNestedSwitch: true,
      tailPosition: false,
    }
    for (const switchCase of node.cases) {
      walkStatementsMut(switchCase.consequent, hooks, inner)
    }
    return
  }

  if (
    t.isWhileStatement(node) ||
    t.isDoWhileStatement(node) ||
    t.isForStatement(node) ||
    t.isForInStatement(node) ||
    t.isForOfStatement(node)
  ) {
    const inner: StatementWalkContext = {
      ...ctx,
      insideNestedLoop: true,
      tailPosition: false,
    }
    node.body = walkSingleChild(node.body, hooks, inner)
    return
  }

  if (t.isWithStatement(node)) {
    node.body = walkSingleChild(node.body, hooks, { ...ctx, tailPosition: false })
  }
}

function walkSingleChild(
  child: t.Statement,
  hooks: StatementWalkHooks,
  ctx: StatementWalkContext,
): t.Statement {
  if (t.isBlockStatement(child)) {
    walkStatementsMut(child.body, hooks, ctx)
    return child
  }
  const wrapped = [child]
  walkStatementsMut(wrapped, hooks, ctx)
  if (wrapped.length === 1) {
    return wrapped[0]!
  }
  return t.blockStatement(wrapped)
}
