import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isInDirectivePrologue } from 'src/utils/ast'

/**
 * Splits comma-sequenced expression statements into one statement each.
 *
 * @example
 * // ◀️ before
 * a(), b(), c();
 *
 * // ▶️ after
 * a();
 * b();
 * c();
 */
export function splitSequenceExpressions(ast: File): void {
  traverse(ast, visitor)
}

const visitor = {
  ExpressionStatement(path: NodePath<t.ExpressionStatement>) {
    if (!t.isSequenceExpression(path.node.expression)) {
      return
    }
    if (typeof path.listKey !== 'string') {
      return
    }
    // Splitting a leading string out of a sequence could create a directive.
    const [first] = path.node.expression.expressions
    if (t.isStringLiteral(first) && isInDirectivePrologue(path)) {
      return
    }
    const statements = path.node.expression.expressions.map((expr) => t.expressionStatement(expr))
    path.replaceWithMultiple(statements)
  },
}
