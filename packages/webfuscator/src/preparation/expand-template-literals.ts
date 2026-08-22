import traverse from '@babel/traverse'
import type { Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isInDirectivePrologue } from '../utils/ast'

/**
 * Rewrites safe template literals as string concatenation. Tagged templates
 * stay intact because the tag receives their quasi structure.
 *
 * Templates use the "string" ToPrimitive hint, while `x + ""` uses "default".
 * Those hints can call object coercion methods in a different order, so only
 * expressions known to produce primitives are expanded.
 *
 * An empty first quasi still matters. It makes `` `${5}` `` produce `"5"`
 * instead of the number `5`.
 *
 * @example
 * // ◀️ before
 * var msg = `sum is ${a + b}`;
 * var raw = `static text`;
 *
 * // ▶️ after
 * var msg = "sum is " + (a + b);
 * var raw = "static text";
 */
export function expandTemplateLiterals(ast: File): void {
  traverse(ast, visitor)
}

const visitor: Visitor = {
  TemplateLiteral(path) {
    const parent = path.parent
    if (t.isTaggedTemplateExpression(parent) && parent.quasi === path.node) {
      return
    }

    const quasis = path.node.quasis
    const expressions = path.node.expressions

    if (expressions.length === 0) {
      // Rewriting a leading template as a string would create a directive.
      if (t.isExpressionStatement(parent) && isInDirectivePrologue(path.parentPath!)) {
        return
      }
      path.replaceWith(t.stringLiteral(quasiValue(quasis[0])))
      return
    }

    for (const expr of expressions) {
      if (!t.isExpression(expr) || !producesPrimitive(expr)) {
        return
      }
    }

    let result: t.Expression = t.stringLiteral(quasiValue(quasis[0]))

    for (let i = 0; i < expressions.length; i++) {
      const expr = expressions[i] as t.Expression
      result = t.binaryExpression('+', result, expr)
      const nextQuasi = quasis[i + 1]
      if (nextQuasi) {
        const value = quasiValue(nextQuasi)
        if (value !== '') {
          result = t.binaryExpression('+', result, t.stringLiteral(value))
        }
      }
    }

    path.replaceWith(result)
  },
}

// These expression kinds always produce primitives, making the coercion hint
// irrelevant. Any kind that can produce an object is excluded.
function producesPrimitive(node: t.Expression): boolean {
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isBigIntLiteral(node) ||
    t.isTemplateLiteral(node) ||
    t.isBinaryExpression(node) ||
    t.isUnaryExpression(node) ||
    t.isUpdateExpression(node)
  )
}

function quasiValue(quasi: t.TemplateElement | undefined): string {
  return quasi?.value.cooked ?? quasi?.value.raw ?? ''
}
