import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { collectLoopLabels, generateLoopLabel, redirectContinues } from '../utils/loop-lowering'

/**
 * Rewrites `do` loops as `while (true)` with an exit test after the body.
 * Continues become breaks from an inner block so they still reach that test.
 * The inner label is omitted when nothing uses it.
 *
 * @example
 * // ◀️ before
 * do {
 *   step();
 *   if (skip()) continue;
 *   log();
 * } while (more());
 *
 * // ▶️ after
 * while (true) {
 *   _doIteration: {
 *     step();
 *     if (skip()) break _doIteration;
 *     log();
 *   }
 *   if (!more()) break;
 * }
 */
export function doWhileToWhile(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  DoWhileStatement(path, state) {
    transformDoWhile(path)
    state.changed = true
  },
}

function transformDoWhile(path: NodePath<t.DoWhileStatement>): void {
  const node = path.node
  const ourLabels = collectLoopLabels(path).ourLabels
  const innerLabel = generateLoopLabel(path, 'doIteration')

  const blockBody: t.BlockStatement = t.isBlockStatement(node.body)
    ? node.body
    : t.blockStatement([node.body])
  const labeledBlock = t.labeledStatement(t.identifier(innerLabel), blockBody)
  const exitTest = t.ifStatement(
    t.unaryExpression('!', node.test),
    t.blockStatement([t.breakStatement()]),
  )
  const whileStmt = t.whileStatement(
    t.booleanLiteral(true),
    t.blockStatement([labeledBlock, exitTest]),
  )

  const newPath = path.replaceWith(whileStmt)[0]
  const rewriteCount = redirectContinues(newPath, innerLabel, ourLabels)

  // Keep the block so body bindings cannot shadow names in the exit test.
  if (rewriteCount === 0) {
    const whileBlock = newPath.node.body as t.BlockStatement
    whileBlock.body = [blockBody, exitTest]
  }
}
