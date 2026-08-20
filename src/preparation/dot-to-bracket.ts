import traverse from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

/**
 * Rewrites `obj.foo` as `obj["foo"]`. Skips already-computed access and
 * private fields; private-name semantics aren't expressible as a string key.
 *
 * @example
 * // ◀️ before
 * user.name = obj.foo.bar;
 * var v = maybe?.value;
 *
 * // ▶️ after
 * user["name"] = obj["foo"]["bar"];
 * var v = maybe?.["value"];
 */
export function dotToBracket(ast: File): void {
  traverse(ast, visitor as Parameters<typeof traverse>[1])
}

const visitor = {
  'MemberExpression|OptionalMemberExpression'(path: {
    node: t.MemberExpression | t.OptionalMemberExpression
  }) {
    convert(path.node)
  },
} as const

function convert(node: t.MemberExpression | t.OptionalMemberExpression): void {
  if (node.computed) {
    return
  }
  if (!t.isIdentifier(node.property)) {
    return
  }
  // Babel 8 narrows members by `computed`, so both fields need widening.
  const bracketed = node as t.MemberExpression | t.OptionalMemberExpression
  bracketed.property = t.stringLiteral(node.property.name)
  bracketed.computed = true
}
