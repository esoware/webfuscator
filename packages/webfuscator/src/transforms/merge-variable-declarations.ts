import * as t from '@babel/types'
import type { File } from '@babel/types'

import { rewriteStatementLists } from '../utils/statement-lists'

/**
 * Merges adjacent variable declarations when their kinds and export wrappers
 * match. It runs in programs, blocks, switch cases, and static blocks, and
 * removes unlabeled empty statements between compatible declarations.
 *
 * @example
 * // ◀️ before
 * let a = 1;
 * let b = 2;
 *
 * // ▶️ after
 * let a = 1,
 *   b = 2;
 */
export function mergeVariableDeclarations(ast: File): boolean {
  return rewriteStatementLists(ast, (statements) =>
    mergeAdjacent(statements.map((path) => path.node)),
  )
}

type StatementLike = t.Program['body'][number]

interface MergeableDeclaration {
  declaration: t.VariableDeclaration
  exported: boolean
}

function mergeAdjacent(list: readonly StatementLike[]): StatementLike[] | null {
  const out: StatementLike[] = []
  let pendingEmpty: t.EmptyStatement[] = []
  let merged = false

  for (const statement of list) {
    if (t.isEmptyStatement(statement) && mergeableDeclaration(out.at(-1)) !== null) {
      pendingEmpty.push(statement)
      continue
    }

    const previous = mergeableDeclaration(out.at(-1))
    const current = mergeableDeclaration(statement)
    if (previous && current && canMerge(previous, current)) {
      out[out.length - 1] = mergePair(previous, current)
      pendingEmpty = []
      merged = true
      continue
    }

    out.push(...pendingEmpty, statement)
    pendingEmpty = []
  }

  out.push(...pendingEmpty)
  return merged ? out : null
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

function canMerge(previous: MergeableDeclaration, current: MergeableDeclaration): boolean {
  return (
    previous.exported === current.exported && previous.declaration.kind === current.declaration.kind
  )
}

function mergePair(previous: MergeableDeclaration, current: MergeableDeclaration): StatementLike {
  const declaration = t.variableDeclaration(previous.declaration.kind, [
    ...previous.declaration.declarations,
    ...current.declaration.declarations,
  ])

  if (!previous.exported) {
    return declaration
  }

  return t.exportNamedDeclaration(declaration)
}
