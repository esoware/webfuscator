import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import type { File } from '@babel/types'

import { rewriteStatementLists } from '../utils/statement-lists'
import type { StatementListContainer } from '../utils/statement-lists'

/**
 * Moves hoisted function declarations to the end of their statement lists
 * without changing their relative order.
 *
 * @example
 * // ◀️ before
 * function area(r) {
 *   return r * r;
 * }
 * log(area(2));
 *
 * // ▶️ after
 * log(area(2));
 * function area(r) {
 *   return r * r;
 * }
 */
export function reorderFunctionDeclarations(ast: File): boolean {
  return rewriteStatementLists(ast, (statements, container) =>
    reorderedStatements(statements, containerAllowsDirective(container)),
  )
}

// Only programs and function bodies recognize directives, so only they need the guard.
function containerAllowsDirective(container: NodePath<StatementListContainer>): boolean {
  if (container.isProgram()) {
    return true
  }
  return container.isBlockStatement() && container.parentPath.isFunction()
}

function reorderedStatements(
  children: NodePath<t.Statement>[],
  canCreateDirective: boolean,
): t.Statement[] | null {
  const rest: t.Statement[] = []
  const moved: t.Statement[] = []
  for (const child of children) {
    if (isMovable(child)) {
      moved.push(child.node)
    } else {
      rest.push(child.node)
    }
  }

  if (moved.length === 0) {
    return null
  }
  if (canCreateDirective && createsDirective(rest)) {
    rest.unshift(moved.shift()!)
  }
  const reordered = [...rest, ...moved]
  return reordered.every((node, index) => node === children[index]?.node) ? null : reordered
}

function createsDirective(statements: readonly t.Statement[]): boolean {
  const first = statements[0]
  return (
    first !== undefined &&
    first.type === 'ExpressionStatement' &&
    first.expression.type === 'StringLiteral'
  )
}

function isMovable(child: NodePath<t.Statement>): boolean {
  return child.isFunctionDeclaration() && child.node.id !== null
}
