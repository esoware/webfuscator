import * as t from '@babel/types'
import type { File } from '@babel/types'

import { rewriteStatementLists } from '../utils/statement-lists'

/**
 * Merges adjacent compatible variable declarations, combines adjacent
 * expression statements with the comma operator, and moves expressions into a
 * following compatible statement when execution order is preserved.
 *
 * @example
 * // ◀️ before
 * function run() {
 *   let first = prepare();
 *   let second = update(first);
 *   record(first);
 *   record(second);
 *   return finish();
 * }
 *
 * // ▶️ after
 * function run() {
 *   let first = prepare(),
 *     second = update(first);
 *   return record(first), record(second), finish();
 * }
 */
export function packExpressions(ast: File): boolean {
  return rewriteStatementLists(ast, (statements) =>
    packStatementList(statements.map((path) => path.node)),
  )
}

type StatementLike = t.Program['body'][number]

function packStatementList(list: readonly StatementLike[]): StatementLike[] | null {
  const declarationsMerged = mergeAdjacentDeclarations(list)
  const expressionsPacked = packExpressionStatements(declarationsMerged ?? list)
  return expressionsPacked ?? declarationsMerged
}

interface MergeableDeclaration {
  declaration: t.VariableDeclaration
  exported: boolean
}

function mergeAdjacentDeclarations(list: readonly StatementLike[]): StatementLike[] | null {
  const out: StatementLike[] = []
  let pendingEmpty: t.EmptyStatement[] = []
  let changed = false

  for (const statement of list) {
    if (t.isEmptyStatement(statement) && mergeableDeclaration(out.at(-1)) !== null) {
      pendingEmpty.push(statement)
      continue
    }

    const previous = mergeableDeclaration(out.at(-1))
    const current = mergeableDeclaration(statement)
    if (previous && current && canMergeDeclarations(previous, current)) {
      out[out.length - 1] = mergeDeclarationPair(previous, current)
      pendingEmpty = []
      changed = true
      continue
    }

    out.push(...pendingEmpty, statement)
    pendingEmpty = []
  }

  out.push(...pendingEmpty)
  return changed ? out : null
}

function mergeableDeclaration(statement: StatementLike | undefined): MergeableDeclaration | null {
  if (statement === undefined) {
    return null
  }
  if (t.isVariableDeclaration(statement)) {
    return { declaration: statement, exported: false }
  }
  if (t.isExportNamedDeclaration(statement) && t.isVariableDeclaration(statement.declaration)) {
    return { declaration: statement.declaration, exported: true }
  }
  return null
}

function canMergeDeclarations(
  previous: MergeableDeclaration,
  current: MergeableDeclaration,
): boolean {
  return (
    previous.exported === current.exported && previous.declaration.kind === current.declaration.kind
  )
}

function mergeDeclarationPair(
  previous: MergeableDeclaration,
  current: MergeableDeclaration,
): StatementLike {
  const declaration = t.variableDeclaration(previous.declaration.kind, [
    ...previous.declaration.declarations,
    ...current.declaration.declarations,
  ])

  return previous.exported ? t.exportNamedDeclaration(declaration) : declaration
}

function packExpressionStatements(list: readonly StatementLike[]): StatementLike[] | null {
  const out: StatementLike[] = []
  let pending: t.ExpressionStatement[] = []
  let changed = false

  const flush = (): void => {
    if (pending.length === 1) {
      out.push(pending[0]!)
    } else if (pending.length > 1) {
      out.push(
        t.expressionStatement(
          expressionFrom(
            flattenExpressions(pending.map((pendingStatement) => pendingStatement.expression)),
          ),
        ),
      )
      changed = true
    }
    pending = []
  }

  for (const statement of list) {
    if (t.isExpressionStatement(statement)) {
      pending.push(statement)
      continue
    }

    if (pending.length > 0) {
      const expressions = flattenExpressions(
        pending.map((pendingStatement) => pendingStatement.expression),
      )
      if (prependToConsumer(statement, expressions)) {
        out.push(statement)
        pending = []
        changed = true
        continue
      }
    }

    flush()
    out.push(statement)
  }

  flush()
  return changed ? out : null
}

function prependToConsumer(statement: StatementLike, expressions: t.Expression[]): boolean {
  if (t.isReturnStatement(statement)) {
    const argument = statement.argument ?? t.unaryExpression('void', t.numericLiteral(0))
    statement.argument = prependExpressions(expressions, argument)
    return true
  }
  if (t.isThrowStatement(statement)) {
    statement.argument = prependExpressions(expressions, statement.argument)
    return true
  }
  if (t.isIfStatement(statement)) {
    statement.test = prependExpressions(expressions, statement.test)
    return true
  }
  if (t.isSwitchStatement(statement)) {
    statement.discriminant = prependExpressions(expressions, statement.discriminant)
    return true
  }
  if (t.isWithStatement(statement)) {
    statement.object = prependExpressions(expressions, statement.object)
    return true
  }
  if (t.isForStatement(statement)) {
    if (t.isVariableDeclaration(statement.init)) {
      return false
    }
    statement.init = statement.init
      ? prependExpressions(expressions, statement.init)
      : expressionFrom(expressions)
    return true
  }
  if (t.isForInStatement(statement) || t.isForOfStatement(statement)) {
    if (!canPrependToForXRight(statement.left)) {
      return false
    }
    statement.right = prependExpressions(expressions, statement.right)
    return true
  }
  return false
}

function canPrependToForXRight(left: t.ForInStatement['left']): boolean {
  if (!t.isVariableDeclaration(left)) {
    return true
  }
  // A lexical loop head is active while the right side runs; a preceding
  // statement is outside it. A legacy var initializer also runs before the
  // right side.
  return left.kind === 'var' && left.declarations.every((declaration) => !declaration.init)
}

function flattenExpressions(input: readonly t.Expression[]): t.Expression[] {
  const remaining: t.Expression[] = []
  for (let index = input.length - 1; index >= 0; index--) {
    remaining.push(input[index]!)
  }

  const expressions: t.Expression[] = []
  while (remaining.length > 0) {
    const expression = remaining.pop()!
    if (t.isSequenceExpression(expression)) {
      for (let index = expression.expressions.length - 1; index >= 0; index--) {
        remaining.push(expression.expressions[index]!)
      }
    } else {
      expressions.push(expression)
    }
  }
  return expressions
}

function prependExpressions(
  expressions: readonly t.Expression[],
  consumer: t.Expression,
): t.Expression {
  const flattenedConsumer = flattenExpressions([consumer])
  return expressionFrom([...expressions, ...flattenedConsumer])
}

function expressionFrom(expressions: t.Expression[]): t.Expression {
  return expressions.length === 1 ? expressions[0]! : t.sequenceExpression(expressions)
}
