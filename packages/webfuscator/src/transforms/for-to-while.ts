import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'
import { collectLoopLabels, generateLoopLabel, redirectContinues } from '../utils/loop-lowering'

/**
 * Rewrites classic `for` loops as an initializer followed by `while`. Continues
 * become breaks from an inner block so the update still runs. Iterator loops
 * stay unchanged.
 *
 * @example
 * // ◀️ before
 * for (var i = 0; i < 3; i++) {
 *   if (skip(i)) {
 *     continue;
 *   }
 *   log(i);
 * }
 *
 * // ▶️ after
 * var i = 0;
 * while (i < 3) {
 *   _forIter: {
 *     if (skip(i)) {
 *       break _forIter;
 *     }
 *     log(i);
 *   }
 *   i++;
 * }
 */
export function forToWhile(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  ForStatement(path, state) {
    if (transformFor(path)) {
      state.changed = true
    }
  },
}

function transformFor(path: NodePath<t.ForStatement>): boolean {
  const node = path.node

  // One hoisted binding cannot preserve lexical per-iteration captures.
  if (t.isVariableDeclaration(node.init) && node.init.kind !== 'var') {
    return false
  }

  const loopLabels = collectLoopLabels(path)
  const innerLabel = generateLoopLabel(path, 'forIteration')

  const initStmt = buildInitStatement(node.init)

  const blockBody: t.BlockStatement = t.isBlockStatement(node.body)
    ? node.body
    : t.blockStatement([node.body])

  const labeledBlock = t.labeledStatement(t.identifier(innerLabel), blockBody)

  const whileBody: t.Statement[] = [labeledBlock]
  if (node.update) {
    whileBody.push(t.expressionStatement(node.update))
  }

  const test = node.test ?? t.booleanLiteral(true)
  const whileStmt = t.whileStatement(test, t.blockStatement(whileBody))

  const newPath = path.replaceWith(whileStmt)[0]
  const rewriteCount = redirectContinues(newPath, innerLabel, loopLabels.ourLabels)

  // Keep the block so body bindings cannot shadow names in the update.
  if (rewriteCount === 0) {
    const whileBlock = newPath.node.body as t.BlockStatement
    whileBlock.body[0] = blockBody
  }

  hoistInit(loopLabels.outermost, initStmt)
  return true
}

// Babel repoints a non-list path after `insertBefore`, which can drop the init
// during the later loop replacement. Replace that slot with one block instead.
function hoistInit(outermost: NodePath<t.Statement>, initStmt: t.Statement | null): void {
  if (!initStmt) {
    return
  }
  if (outermost.inList) {
    outermost.insertBefore(initStmt)
    return
  }
  const loopStatement = outermost.node
  outermost.replaceWith(t.blockStatement([initStmt, loopStatement]))
}

function buildInitStatement(init: t.ForStatement['init']): t.Statement | null {
  if (!init) {
    return null
  }
  if (t.isVariableDeclaration(init)) {
    return init
  }
  return t.expressionStatement(init)
}
