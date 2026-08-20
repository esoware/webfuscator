import traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

type LoopNode =
  | t.WhileStatement
  | t.DoWhileStatement
  | t.ForStatement
  | t.ForInStatement
  | t.ForOfStatement

/**
 * Wraps single-statement bodies of control-flow constructs in BlockStatements,
 * and converts concise arrow bodies into block bodies with an explicit `return`.
 * Leaves an `IfStatement` alternate alone so `else if` chains survive.
 *
 * @example
 * // ◀️ before
 * if (x) log(1);
 * else log(2);
 * var fn = x => x + 1;
 *
 * // ▶️ after
 * if (x) {
 *   log(1);
 * } else {
 *   log(2);
 * }
 * var fn = x => {
 *   return x + 1;
 * };
 */
export function wrapSingleStatements(ast: File): void {
  traverse(ast, visitor as Parameters<typeof traverse>[1])
}

const visitor = {
  IfStatement(path: { node: t.IfStatement }) {
    const { node } = path
    if (!t.isBlockStatement(node.consequent)) {
      node.consequent = t.blockStatement([node.consequent])
    }
    if (node.alternate && !t.isBlockStatement(node.alternate) && !t.isIfStatement(node.alternate)) {
      node.alternate = t.blockStatement([node.alternate])
    }
  },
  Loop(path: { node: LoopNode }) {
    wrapLoopBody(path.node)
  },
  ArrowFunctionExpression(path: { node: t.ArrowFunctionExpression }) {
    const { node } = path
    if (!t.isBlockStatement(node.body)) {
      node.body = t.blockStatement([t.returnStatement(node.body)])
      node.expression = false
    }
  },
} as const

function wrapLoopBody(node: LoopNode): void {
  if (!t.isBlockStatement(node.body)) {
    node.body = t.blockStatement([node.body])
  }
}
