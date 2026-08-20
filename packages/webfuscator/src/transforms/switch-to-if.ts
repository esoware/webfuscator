import type { NodePath, Scope, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isPure } from 'src/analysis/purity'
import { traverseForChanges } from 'src/utils/change-tracking'
import type { ChangeState } from 'src/utils/change-tracking'
import { isPrimitiveLiteral } from 'src/utils/literal'
import { generateLoopLabel } from 'src/utils/loop-lowering'

/**
 * Lowers `switch` to an `if` chain or, when cases fall through, a labeled block
 * with a fallthrough flag. Case tests keep source order and evaluation count.
 * Cases with lexical or function declarations stay unchanged because separate
 * `if` blocks cannot preserve the shared switch scope.
 *
 * @example
 * // ◀️ before
 * switch (x) {
 *   case 1: a(); break;
 *   case 2: b();
 *   case 3: c(); break;
 *   default: d();
 * }
 *
 * // ▶️ after
 * _switch: {
 *   var _switchValue = x;
 *   var _switchFall = false;
 *   if (_switchFall || _switchValue === 1) { _switchFall = true; a(); break _switch; }
 *   if (_switchFall || _switchValue === 2) { _switchFall = true; b(); }
 *   if (_switchFall || _switchValue === 3) { _switchFall = true; c(); break _switch; }
 *   d();
 * }
 */
export function switchToIf(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  SwitchStatement(path, state) {
    if (transformSwitch(path)) {
      state.changed = true
    }
  },
}

function transformSwitch(path: NodePath<t.SwitchStatement>): boolean {
  const { node } = path
  // Separate `if` blocks cannot preserve cross-case lexical scope or Annex B
  // function hoisting.
  if (hasBlockScopedDeclaration(node)) {
    return false
  }
  if (canLowerToIfElseChain(node)) {
    lowerToIfElseChain(path)
    return true
  }
  if (!labeledLoweringIsSafe(node, path.scope, path)) {
    return false
  }
  lowerToLabeledBlock(path)
  return true
}

function hasBlockScopedDeclaration(node: t.SwitchStatement): boolean {
  for (const caseClause of node.cases) {
    for (const stmt of caseClause.consequent) {
      if (
        (t.isVariableDeclaration(stmt) && stmt.kind !== 'var') ||
        t.isClassDeclaration(stmt) ||
        t.isFunctionDeclaration(stmt) ||
        isLabeledFunctionDeclaration(stmt)
      ) {
        return true
      }
    }
  }
  return false
}

// Babel hides an Annex B.3.4 labeled function under LabeledStatement wrappers.
function isLabeledFunctionDeclaration(stmt: t.Statement): boolean {
  let current: t.Statement = stmt
  while (t.isLabeledStatement(current)) {
    current = current.body
  }
  return t.isFunctionDeclaration(current)
}

// A non-final default needs match results from later cases. Precomputing that
// result rereads tests, so every test must be pure in this shape.
function labeledLoweringIsSafe(
  node: t.SwitchStatement,
  scope: Scope,
  referencePath: NodePath,
): boolean {
  const defaultIndex = node.cases.findIndex((caseClause) => caseClause.test === null)
  if (defaultIndex === -1 || defaultIndex === node.cases.length - 1) {
    return true
  }
  return node.cases.every(
    (caseClause) => caseClause.test == null || isPure(caseClause.test, scope, referencePath),
  )
}

function canLowerToIfElseChain(node: t.SwitchStatement): boolean {
  for (let i = 0; i < node.cases.length; i++) {
    if (!caseEligibleForIfElseChain(node.cases[i]!, i === node.cases.length - 1)) {
      return false
    }
  }
  return true
}

function caseEligibleForIfElseChain(caseClause: t.SwitchCase, isLast: boolean): boolean {
  const { consequent } = caseClause
  if (consequent.length === 0) {
    return isLast
  }
  const last = consequent.at(-1)!
  const terminates = isCaseTerminator(last)
  if (!terminates && !isLast) {
    return false
  }
  for (let i = 0; i < consequent.length - 1; i++) {
    if (containsTopLevelUnlabeledBreak(consequent[i]!)) {
      return false
    }
  }
  if (!(t.isBreakStatement(last) && !last.label) && containsTopLevelUnlabeledBreak(last)) {
    return false
  }
  return true
}

function isCaseTerminator(stmt: t.Statement): boolean {
  if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) {
    return true
  }
  if (t.isBreakStatement(stmt) || t.isContinueStatement(stmt)) {
    return true
  }
  return false
}

function containsTopLevelUnlabeledBreak(node: t.Node): boolean {
  if (t.isBreakStatement(node) && !node.label) {
    return true
  }
  if (t.isFunction(node) || t.isLoop(node) || t.isSwitchStatement(node)) {
    return false
  }
  const keys = (t.VISITOR_KEYS as Record<string, string[]>)[node.type]
  if (!keys) {
    return false
  }
  for (const key of keys) {
    const child = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(child)) {
      for (const entry of child) {
        if (
          entry &&
          typeof (entry as t.Node).type === 'string' &&
          containsTopLevelUnlabeledBreak(entry as t.Node)
        ) {
          return true
        }
      }
    } else if (
      child &&
      typeof (child as t.Node).type === 'string' &&
      containsTopLevelUnlabeledBreak(child as t.Node)
    ) {
      return true
    }
  }
  return false
}

// Declaration-bearing cases were refused, leaving only a trailing break to drop.
function buildBody(consequent: t.Statement[]): t.BlockStatement {
  const body = [...consequent]
  const last = body.at(-1)
  if (last && t.isBreakStatement(last) && !last.label) {
    body.pop()
  }
  return t.blockStatement(body)
}

function lowerToIfElseChain(path: NodePath<t.SwitchStatement>): void {
  const { node } = path
  const { scope } = path

  let discriminantExpr: t.Expression
  const preStmts: t.Statement[] = []
  if (isPrimitiveLiteral(node.discriminant)) {
    discriminantExpr = node.discriminant
  } else {
    const valueName = scope.generateUid('switchValue')
    discriminantExpr = t.identifier(valueName)
    preStmts.push(
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(valueName), node.discriminant),
      ]),
    )
  }

  const nonDefaultCases = node.cases.filter((caseClause) => caseClause.test !== null)
  const defaultCase = node.cases.find((caseClause) => caseClause.test === null)

  let chain: t.Statement | null = null
  if (defaultCase) {
    const defaultBody = buildBody(defaultCase.consequent)
    if (defaultBody.body.length > 0) {
      chain = defaultBody
    }
  }
  for (let i = nonDefaultCases.length - 1; i >= 0; i--) {
    const caseClause = nonDefaultCases[i]!
    const test = t.binaryExpression('===', t.cloneNode(discriminantExpr), caseClause.test!)
    chain = t.ifStatement(test, buildBody(caseClause.consequent), chain ?? undefined)
  }

  const replacement: t.Statement[] = [...preStmts]
  if (chain) {
    replacement.push(chain)
  }

  if (replacement.length === 0) {
    path.remove()
    return
  }
  if (replacement.length === 1) {
    path.replaceWith(replacement[0]!)
    return
  }
  // Wrap single-statement slots so replacement cannot drop an enclosing label.
  if (typeof path.listKey === 'string') {
    path.replaceWithMultiple(replacement)
    return
  }
  path.replaceWith(t.blockStatement(replacement))
}

function lowerToLabeledBlock(path: NodePath<t.SwitchStatement>): void {
  const { node } = path
  const { scope } = path

  // `scope.generateUid` alone can collide with enclosing or nested labels.
  const labelName = generateLoopLabel(path, 'switch')
  const valueName = scope.generateUid('switchValue')
  const fallName = scope.generateUid('switchFall')

  const defaultIndex = node.cases.findIndex((caseClause) => caseClause.test === null)
  const defaultIsLast = defaultIndex === node.cases.length - 1

  const statements: t.Statement[] = [
    t.variableDeclaration('var', [
      t.variableDeclarator(t.identifier(valueName), node.discriminant),
    ]),
    t.variableDeclaration('var', [
      t.variableDeclarator(t.identifier(fallName), t.booleanLiteral(false)),
    ]),
  ]

  // `_switchDefault` records whether any case matches while the default body
  // remains in source order. Safety checks already proved rereads pure.
  let defaultName: string | null = null
  if (defaultIndex !== -1 && !defaultIsLast) {
    defaultName = scope.generateUid('switchDefault')
    const nonDefaultTests = node.cases
      .map((caseClause) => caseClause.test)
      .filter((test): test is t.Expression => test !== null)
    const anyMatch: t.Expression = nonDefaultTests
      .map((test) => t.binaryExpression('===', t.identifier(valueName), t.cloneNode(test)))
      .reduce<t.Expression>(
        (acc, expr, i) => (i === 0 ? expr : t.logicalExpression('||', acc, expr)),
        t.booleanLiteral(false),
      )
    statements.push(
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(defaultName), t.unaryExpression('!', anyMatch)),
      ]),
    )
  }

  for (const caseClause of node.cases) {
    const isDefault = caseClause.test === null

    // A final default always runs once control reaches it, with nothing after it.
    if (isDefault && defaultIsLast) {
      statements.push(...caseClause.consequent)
      continue
    }

    const condition: t.Expression = isDefault
      ? t.logicalExpression('||', t.identifier(fallName), t.identifier(defaultName!))
      : t.logicalExpression(
          '||',
          t.identifier(fallName),
          t.binaryExpression('===', t.identifier(valueName), caseClause.test as t.Expression),
        )

    const body: t.Statement[] = [
      t.expressionStatement(
        t.assignmentExpression('=', t.identifier(fallName), t.booleanLiteral(true)),
      ),
      ...caseClause.consequent,
    ]

    statements.push(t.ifStatement(condition, t.blockStatement(body)))
  }

  const labeledBlock = t.labeledStatement(t.identifier(labelName), t.blockStatement(statements))

  const [labeledPath] = path.replaceWith(labeledBlock)
  rewriteUnlabeledBreaks(labeledPath, labelName)
}

function rewriteUnlabeledBreaks(path: NodePath<t.Node>, labelName: string): void {
  path.traverse(rewriteBreaksVisitor, { labelName })
}

interface RewriteBreaksState {
  labelName: string
}

const rewriteBreaksVisitor: Visitor<RewriteBreaksState> = {
  BreakStatement(path, state) {
    if (path.node.label) {
      return
    }
    path.node.label = t.identifier(state.labelName)
  },
  'Function|Loop|SwitchStatement'(path) {
    ;(path as NodePath).skip()
  },
}
