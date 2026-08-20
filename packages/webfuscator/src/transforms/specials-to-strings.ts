import traverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import type { TransformContext } from 'src/options'
import { enclosingScopeHasDirectEval, isInsideWith } from 'src/utils/ast'
import type { ChangeState } from 'src/utils/change-tracking'
import { mulberry32 } from 'src/utils/random'
import { StringGenerator } from 'src/utils/string-generator'

/**
 * Rewrites five constant-like values through strings for later string mangling:
 *
 *   - `true`     -> `!!"<random>"`
 *   - `false`    -> `!"<random>"`
 *   - `NaN`      -> `+"<random>"`
 *   - `undefined`-> `void "<random>"`
 *   - `Infinity` -> `1/!"<random>"`
 *
 * Generated strings are nonempty and nonnumeric, fixing their truthiness and
 * numeric coercion.
 *
 * `NaN`, `Infinity`, and `undefined` require genuine global reads. Delete and
 * write positions stay unchanged because the replacement is not a reference.
 *
 * @example
 * // ◀️ before
 * if (x === undefined) return NaN;
 * var lim = !done ? Infinity : 0;
 * var flag = !x ? true : false;
 *
 * // ▶️ after
 * if (x === void "ab") return +"cd";
 * var lim = !done ? 1 / !"ef" : 0;
 * var flag = !x ? !!"gh" : !"ij";
 */
export function specialsToStrings(ast: File, ctx: TransformContext): boolean {
  const state: State = {
    changed: false,
    generator: new StringGenerator(ctx.stringGeneratorMode, mulberry32(ctx.seed)),
  }
  traverse(ast, visitor, undefined, state)
  return state.changed
}

interface State extends ChangeState {
  generator: StringGenerator
}

const GLOBAL_SPECIALS = new Set(['NaN', 'Infinity', 'undefined'])

const visitor: Visitor<State> = {
  BooleanLiteral(path, state) {
    const str = t.stringLiteral(state.generator.next())
    const negated = t.unaryExpression('!', str)
    path.replaceWith(path.node.value ? t.unaryExpression('!', negated) : negated)
    path.skip()
    state.changed = true
  },
  Identifier(path, state) {
    const { name } = path.node
    if (!GLOBAL_SPECIALS.has(name)) {
      return
    }
    if (!path.isReferencedIdentifier()) {
      return
    }
    if (path.scope.getBinding(name)) {
      return
    }
    // Replacements are not write targets. `with` and eval can also shadow globals.
    if (isWriteTarget(path) || isInsideWith(path) || enclosingScopeHasDirectEval(path)) {
      return
    }
    const str = t.stringLiteral(state.generator.next())
    path.replaceWith(buildGlobalReplacement(name, str))
    path.skip()
    state.changed = true
  },
}

function buildGlobalReplacement(name: string, str: t.StringLiteral): t.Expression {
  if (name === 'undefined') {
    return t.unaryExpression('void', str)
  }
  if (name === 'NaN') {
    return t.unaryExpression('+', str)
  }
  return t.binaryExpression('/', t.numericLiteral(1), t.unaryExpression('!', str))
}

// Babel calls update and iterator targets references, but replacements there
// would not be assignable. Delete also distinguishes references from values.
function isWriteTarget(path: NodePath<t.Identifier>): boolean {
  const { parentPath } = path
  if (!parentPath) {
    return false
  }
  if (parentPath.isUpdateExpression({ argument: path.node })) {
    return true
  }
  if (parentPath.isAssignmentExpression({ left: path.node })) {
    return true
  }
  if (parentPath.isUnaryExpression({ argument: path.node, operator: 'delete' })) {
    return true
  }
  if (
    (parentPath.isForInStatement() || parentPath.isForOfStatement()) &&
    parentPath.node.left === path.node
  ) {
    return true
  }
  return false
}
