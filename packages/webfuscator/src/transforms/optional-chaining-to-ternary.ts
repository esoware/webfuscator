import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isInsideWith } from '../utils/ast'
import { traverseForChanges } from '../utils/change-tracking'
import type { ChangeState } from '../utils/change-tracking'

/**
 * Rewrites optional chains as nested ternaries. Side-effectful receivers are
 * cached, and member calls retain their `this`. Optional deletion short-circuits
 * to `true` as required by ECMA-262 13.5.1.
 *
 * @example
 * // ◀️ before
 * obj?.m(arg);
 * delete obj?.x;
 * a?.b?.c;
 *
 * // ▶️ after
 * obj == null ? void 0 : (_m = obj.m).call(obj, arg);
 * obj == null ? true : delete obj.x;
 * a == null ? void 0 : (_b = a.b) == null ? void 0 : _b.c;
 */
export function optionalChainingToTernary(ast: File): boolean {
  return traverseForChanges(ast, visitor)
}

const visitor: Visitor<ChangeState> = {
  OptionalMemberExpression(path, state) {
    if (lowerOptionalChain(path)) {
      state.changed = true
    }
  },
  OptionalCallExpression(path, state) {
    if (lowerOptionalChain(path)) {
      state.changed = true
    }
  },
}

function lowerOptionalChain(path: OptionalPath): boolean {
  // `with` can make a repeated receiver name invoke a getter twice.
  if (isInsideWith(path)) {
    return false
  }
  if (isInsideOptionalChain(path)) {
    return false
  }
  // A tagged optional chain needs explicit parentheses to remain valid and keep
  // the tag receiver.
  if (isBareTaggedTemplateTag(path)) {
    path.replaceWith(t.parenthesizedExpression(path.node))
    path.skip()
    return true
  }
  return transformChain(path)
}

// Wrap a direct tagged-template parent once.
function isBareTaggedTemplateTag(path: OptionalPath): boolean {
  const parent = path.parentPath
  return parent != null && parent.isTaggedTemplateExpression() && parent.node.tag === path.node
}

type OptionalNode = t.OptionalMemberExpression | t.OptionalCallExpression
type OptionalPath = NodePath<OptionalNode>

function isInsideOptionalChain(path: NodePath): boolean {
  const parent = path.parentPath
  if (!parent) {
    return false
  }
  if (parent.isOptionalMemberExpression()) {
    return parent.node.object === path.node
  }
  if (parent.isOptionalCallExpression()) {
    return parent.node.callee === path.node
  }
  return false
}

// Refuse member optional calls because `.call` is shadowable, `super` because its
// HomeObject cannot move, and callee or tag chains because ternaries lose their
// receiver. Check before mutating the chain.
function chainIsUnsafe(path: OptionalPath): boolean {
  let node: t.Node = path.node
  for (;;) {
    if (t.isOptionalCallExpression(node)) {
      const callee: t.Node = node.callee
      if (node.optional && (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee))) {
        return true
      }
      if (t.isSuper(callee)) {
        return true
      }
      node = callee
    } else if (t.isOptionalMemberExpression(node)) {
      const object: t.Node = node.object
      if (t.isSuper(object)) {
        return true
      }
      node = object
    } else {
      break
    }
  }
  let child: t.Node = path.node
  let parent = path.parentPath
  while (parent?.isParenthesizedExpression() && parent.node.expression === child) {
    child = parent.node
    parent = parent.parentPath
  }
  if (!parent) {
    return false
  }
  if ((parent.isCallExpression() || parent.isNewExpression()) && parent.node.callee === child) {
    return true
  }
  return parent.isTaggedTemplateExpression() && parent.node.tag === child
}

function transformChain(path: OptionalPath): boolean {
  if (chainIsUnsafe(path)) {
    return false
  }

  const optionals: (t.MemberExpression | t.CallExpression)[] = []

  let cur: NodePath = path
  while (cur.isOptionalMemberExpression() || cur.isOptionalCallExpression()) {
    const node = cur.node
    if (node.optional) {
      optionals.push(node as unknown as t.MemberExpression | t.CallExpression)
    }
    // Demotion keeps the same fields and removes `optional`.
    if (cur.isOptionalMemberExpression()) {
      ;(node as unknown as { type: string }).type = 'MemberExpression'
      cur = cur.get('object') as NodePath
    } else {
      ;(node as unknown as { type: string }).type = 'CallExpression'
      cur = cur.get('callee') as NodePath
    }
  }

  if (optionals.length === 0) {
    return false
  }

  const parent = path.parentPath
  const isDelete =
    parent !== null &&
    parent.isUnaryExpression() &&
    parent.node.operator === 'delete' &&
    parent.node.argument === path.node

  // `void 0` cannot be shadowed like `undefined`.
  const shortCircuit: t.Expression = isDelete
    ? t.booleanLiteral(true)
    : t.unaryExpression('void', t.numericLiteral(0))

  let replacementPath: NodePath = path

  for (let i = optionals.length - 1; i >= 0; i--) {
    const node = optionals[i]!
    const isCall = t.isCallExpression(node)
    const chain: t.Expression | t.Super = isCall
      ? ((node as t.CallExpression).callee as t.Expression | t.Super)
      : (node as t.MemberExpression).object

    if (t.isSuper(chain)) {
      return false
    }

    let check: t.Expression

    if (path.scope.isStatic(chain)) {
      // The receiver stays in the member expression, so the check needs its own
      // node. One node under two parents is visited twice, and a later in-place
      // rewrite such as renameIdentifiers then applies itself twice to it.
      check = t.cloneNode(chain)
    } else {
      const tmp = path.scope.generateUidIdentifierBasedOnNode(chain)
      path.scope.push({ id: t.cloneNode(tmp) })
      check = t.assignmentExpression('=', t.cloneNode(tmp), chain)
      if (isCall) {
        ;(node as t.CallExpression).callee = t.cloneNode(tmp)
      } else {
        ;(node as t.MemberExpression).object = t.cloneNode(tmp)
      }
    }

    // A cached member call needs its original receiver as `this`.
    if (isCall && t.isMemberExpression(chain)) {
      const callNode = node as t.CallExpression
      const object = chain.object
      if (!t.isSuper(object)) {
        let context: t.Expression
        const memoized = path.scope.maybeGenerateMemoised(object)
        if (memoized) {
          context = t.cloneNode(memoized)
          chain.object = t.assignmentExpression('=', memoized, object)
        } else {
          context = t.cloneNode(object) as t.Expression
        }
        callNode.arguments.unshift(t.cloneNode(context))
        callNode.callee = t.memberExpression(callNode.callee as t.Expression, t.identifier('call'))
      }
    }

    const condition = t.binaryExpression('==', check, t.nullLiteral())

    let alternate = replacementPath.node as t.Expression
    if (isDelete && i === optionals.length - 1) {
      alternate = t.unaryExpression('delete', alternate)
    }

    const newTernary = t.conditionalExpression(condition, t.cloneNode(shortCircuit), alternate)
    const replaced: NodePath<t.ConditionalExpression> = replacementPath.replaceWith(newTernary)[0]
    replacementPath = replaced.get('alternate')
  }

  if (isDelete) {
    // The ternary already contains deletion, so replace the parent `delete` too.
    parent!.replaceWith(path.node)
  }
  return true
}
