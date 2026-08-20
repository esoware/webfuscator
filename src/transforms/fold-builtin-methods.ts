import traverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { evaluateConstant, isOpaque } from 'src/analysis/constant'
import { enclosingScopeHasDirectEval, isInDirectivePrologue, isInsideWith } from 'src/utils/ast'
import type { ChangeState } from 'src/utils/change-tracking'
import { valueToLiteral } from 'src/utils/literal'

/**
 * Replaces built-in calls and reads with smaller syntax or host-computed
 * constants. Host evaluation requires known arguments and receivers. Shadowed
 * names, optional forms, and regexp methods stay unchanged.
 *
 * @example
 * // ◀️ before
 * Math.pow(2, 3);
 * Array.of(1, 2, 3);
 * "abc".toUpperCase();
 * Math.PI;
 * parseInt("0x1F", 16);
 *
 * // ▶️ after
 * 8;
 * [1, 2, 3];
 * "ABC";
 * 3.141592653589793;
 * 31;
 */
export function foldBuiltinMethods(ast: File): boolean {
  const state: FoldState = { changed: false, patchedRoots: collectPatchedIntrinsics(ast) }
  traverse(ast, visitor, undefined, state)
  return state.changed
}

// Visitor state keeps patched-intrinsic data scoped to one traversal.
interface FoldState extends ChangeState {
  patchedRoots: Set<string>
}

// A written intrinsic root may no longer match the host used for folding.
const INTRINSIC_ROOTS = new Set([
  'Math',
  'String',
  'Number',
  'Array',
  'Boolean',
  'BigInt',
  'Object',
  'Reflect',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'atob',
  'btoa',
  'encodeURI',
  'decodeURI',
  'encodeURIComponent',
  'decodeURIComponent',
])

// These global objects expose intrinsic roots as writable properties.
const GLOBAL_OBJECT_NAMES = new Set(['globalThis', 'window', 'self', 'global'])

function collectPatchedIntrinsics(ast: File): Set<string> {
  const poisoned = new Set<string>()
  const poison = (roots: Iterable<string>): void => {
    for (const root of roots) {
      poisoned.add(root)
    }
  }

  traverse(ast, {
    // An alias can patch its intrinsic later, after further aliasing or calls.
    VariableDeclarator(path) {
      if (path.node.init && t.isIdentifier(path.node.id)) {
        poison(aliasSourceRoots(path.node.init, path.scope))
      }
    },
    AssignmentExpression(path) {
      markWriteTarget(path.node.left, path.scope, poison)
      if (path.node.operator === '=' && t.isIdentifier(path.node.left)) {
        poison(aliasSourceRoots(path.node.right, path.scope))
      }
    },
    UpdateExpression(path) {
      markWriteTarget(path.node.argument, path.scope, poison)
    },
    UnaryExpression(path) {
      // Deletion patches an intrinsic as surely as assignment.
      if (path.node.operator === 'delete') {
        markWriteTarget(path.node.argument, path.scope, poison)
      }
    },
    ForInStatement(path) {
      markWriteTarget(path.node.left, path.scope, poison)
    },
    ForOfStatement(path) {
      markWriteTarget(path.node.left, path.scope, poison)
    },
    CallExpression(path) {
      markMutationCall(path, poison)
    },
    Identifier(path) {
      // Global eval and Function can patch any intrinsic outside this scan.
      const { name } = path.node
      if (name !== 'eval' && name !== 'Function') {
        return
      }
      if (!path.isReferencedIdentifier() || path.scope.getBinding(name)) {
        return
      }
      if (name === 'eval') {
        poison(INTRINSIC_ROOTS)
        return
      }
      const parent = path.parentPath
      if (
        parent &&
        (parent.isCallExpression() || parent.isNewExpression()) &&
        parent.node.callee === path.node
      ) {
        poison(INTRINSIC_ROOTS)
      }
    },
  })
  return poisoned
}

type PoisonSink = (roots: Iterable<string>) => void

// A global-object handle reaches every root. A local binding reaches none.
const NO_ROOTS: readonly string[] = []

// Destructuring writes recurse to each leaf target.
function markWriteTarget(target: t.Node, scope: NodePath['scope'], poison: PoisonSink): void {
  if (t.isArrayPattern(target)) {
    for (const element of target.elements) {
      if (element) {
        markWriteTarget(element, scope, poison)
      }
    }
    return
  }
  if (t.isObjectPattern(target)) {
    for (const prop of target.properties) {
      markWriteTarget(t.isObjectProperty(prop) ? (prop.value as t.Node) : prop, scope, poison)
    }
    return
  }
  if (t.isRestElement(target)) {
    markWriteTarget(target.argument, scope, poison)
    return
  }
  if (t.isAssignmentPattern(target)) {
    markWriteTarget(target.left, scope, poison)
    return
  }
  poison(writeTargetRoots(target, scope))
}

// Only genuine Object and Reflect bulk mutation methods count as patches.
function markMutationCall(path: NodePath<t.CallExpression>, poison: PoisonSink): void {
  const { callee } = path.node
  // Preparation may already have changed the method to bracket syntax.
  if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object)) {
    return
  }
  const method = staticPropertyName(callee)
  if (method === null || path.scope.getBinding(callee.object.name)) {
    return
  }
  if (!isMutatingIntrinsicMethod(callee.object.name, method)) {
    return
  }
  const [firstArg] = path.node.arguments
  if (!firstArg || !t.isExpression(firstArg)) {
    return
  }
  poison(mutationTargetRoots(firstArg, path.scope))
}

function isMutatingIntrinsicMethod(receiver: string, method: string): boolean {
  if (receiver === 'Object') {
    return (
      method === 'assign' ||
      method === 'defineProperty' ||
      method === 'defineProperties' ||
      method === 'setPrototypeOf'
    )
  }
  if (receiver === 'Reflect') {
    return (
      method === 'set' ||
      method === 'defineProperty' ||
      method === 'deleteProperty' ||
      method === 'setPrototypeOf'
    )
  }
  return false
}

// A bare write reaches an intrinsic only through a genuine global reference.
function writeTargetRoots(target: t.Node, scope: NodePath['scope']): Iterable<string> {
  if (t.isIdentifier(target)) {
    if (scope.getBinding(target.name)) {
      return NO_ROOTS
    }
    return INTRINSIC_ROOTS.has(target.name) ? [target.name] : NO_ROOTS
  }
  if (t.isMemberExpression(target)) {
    return memberTargetRoots(target, scope)
  }
  return NO_ROOTS
}

// Mutating the global object can reach every intrinsic root.
function mutationTargetRoots(target: t.Node, scope: NodePath['scope']): Iterable<string> {
  if (t.isIdentifier(target)) {
    if (scope.getBinding(target.name)) {
      return NO_ROOTS
    }
    if (INTRINSIC_ROOTS.has(target.name)) {
      return [target.name]
    }
    return GLOBAL_OBJECT_NAMES.has(target.name) ? INTRINSIC_ROOTS : NO_ROOTS
  }
  if (t.isMemberExpression(target)) {
    return memberTargetRoots(target, scope)
  }
  return NO_ROOTS
}

function memberTargetRoots(member: t.MemberExpression, scope: NodePath['scope']): Iterable<string> {
  const root = memberRoot(member)
  if (!root || scope.getBinding(root.name)) {
    return NO_ROOTS
  }
  if (INTRINSIC_ROOTS.has(root.name)) {
    return [root.name]
  }
  if (GLOBAL_OBJECT_NAMES.has(root.name)) {
    const name = staticPropertyName(innermostMember(member))
    if (name === null) {
      return INTRINSIC_ROOTS
    }
    return INTRINSIC_ROOTS.has(name) ? [name] : NO_ROOTS
  }
  return NO_ROOTS
}

// Namespace and prototype aliases can patch roots. Method aliases cannot.
function aliasSourceRoots(value: t.Node, scope: NodePath['scope']): Iterable<string> {
  if (t.isIdentifier(value)) {
    if (scope.getBinding(value.name)) {
      return NO_ROOTS
    }
    if (INTRINSIC_ROOTS.has(value.name)) {
      return [value.name]
    }
    return GLOBAL_OBJECT_NAMES.has(value.name) ? INTRINSIC_ROOTS : NO_ROOTS
  }
  if (t.isMemberExpression(value)) {
    const root = memberRoot(value)
    if (!root || scope.getBinding(root.name)) {
      return NO_ROOTS
    }
    if (INTRINSIC_ROOTS.has(root.name)) {
      return staticPropertyName(value) === 'prototype' ? [root.name] : NO_ROOTS
    }
    if (GLOBAL_OBJECT_NAMES.has(root.name)) {
      const name = staticPropertyName(innermostMember(value))
      if (name !== null && INTRINSIC_ROOTS.has(name)) {
        return [name]
      }
    }
  }
  return NO_ROOTS
}

function memberRoot(node: t.MemberExpression): t.Identifier | null {
  let current: t.Expression = node
  while (t.isMemberExpression(current)) {
    current = current.object as t.Expression
  }
  return t.isIdentifier(current) ? current : null
}

// For `a.b.c`, `a.b` holds the property reached directly from the chain root.
function innermostMember(node: t.MemberExpression): t.MemberExpression {
  let current = node
  while (t.isMemberExpression(current.object)) {
    current = current.object
  }
  return current
}

const visitor: Visitor<FoldState> = {
  CallExpression: {
    exit(path, state) {
      if (tryFoldBuiltinCall(path, state.patchedRoots)) {
        state.changed = true
      }
    },
  },
  MemberExpression: {
    exit(path, state) {
      if (tryFoldBuiltinMember(path, state.patchedRoots)) {
        state.changed = true
      }
    },
  },
}

function tryFoldBuiltinCall(path: NodePath<t.CallExpression>, patchedRoots: Set<string>): boolean {
  const before = path.node
  handleCall(path, patchedRoots)
  return path.node !== before || path.removed
}

function tryFoldBuiltinMember(
  path: NodePath<t.MemberExpression>,
  patchedRoots: Set<string>,
): boolean {
  const before = path.node
  handleMember(path, patchedRoots)
  return path.node !== before || path.removed
}

const MATH_CONSTANTS = new Map<string, number>([
  ['PI', Math.PI],
  ['E', Math.E],
  ['LN2', Math.LN2],
  ['LN10', Math.LN10],
  ['LOG2E', Math.LOG2E],
  ['LOG10E', Math.LOG10E],
  ['SQRT2', Math.SQRT2],
  ['SQRT1_2', Math.SQRT1_2],
])

const NUMBER_CONSTANTS = new Map<string, number>([
  ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
  ['MIN_SAFE_INTEGER', Number.MIN_SAFE_INTEGER],
  ['MAX_VALUE', Number.MAX_VALUE],
  ['MIN_VALUE', Number.MIN_VALUE],
  ['EPSILON', Number.EPSILON],
])

const MATH_FUNCTIONS = new Set([
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'cbrt',
  'ceil',
  'clz32',
  'cos',
  'cosh',
  'exp',
  'expm1',
  'floor',
  'fround',
  'hypot',
  'imul',
  'log',
  'log10',
  'log1p',
  'log2',
  'max',
  'min',
  'round',
  'sign',
  'sin',
  'sinh',
  'sqrt',
  'tan',
  'tanh',
  'trunc',
])

const NUMBER_NS_FUNCTIONS = new Set([
  'isNaN',
  'isFinite',
  'isInteger',
  'isSafeInteger',
  'parseInt',
  'parseFloat',
])

const STRING_NS_FUNCTIONS = new Set(['fromCharCode', 'fromCodePoint'])

const GLOBAL_FUNCTIONS = new Set([
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'atob',
  'btoa',
  'encodeURI',
  'decodeURI',
  'encodeURIComponent',
  'decodeURIComponent',
])

const STRING_PROTOTYPE_METHODS = new Set([
  'charAt',
  'charCodeAt',
  'codePointAt',
  'toUpperCase',
  'toLowerCase',
  'slice',
  'substring',
  'substr',
  'trim',
  'trimStart',
  'trimEnd',
  'trimLeft',
  'trimRight',
  'indexOf',
  'lastIndexOf',
  'includes',
  'startsWith',
  'endsWith',
  'padStart',
  'padEnd',
  'at',
  'normalize',
  'repeat',
  'concat',
])

const NUMBER_PROTOTYPE_METHODS = new Set(['toString', 'toFixed', 'toExponential', 'toPrecision'])

const BOOLEAN_PROTOTYPE_METHODS = new Set(['toString'])

const BIGINT_PROTOTYPE_METHODS = new Set(['toString'])

function staticPropertyName(node: t.MemberExpression): string | null {
  const prop = node.property
  if (!node.computed) {
    if (t.isIdentifier(prop)) {
      return prop.name
    }
    return null
  }
  if (t.isStringLiteral(prop)) {
    return prop.value
  }
  if (t.isNumericLiteral(prop)) {
    return String(prop.value)
  }
  return null
}

// Write targets require references. A folded literal would be invalid syntax,
// including when the member sits inside a destructuring target.
function isReferenceRequiredPosition(path: NodePath<t.MemberExpression>): boolean {
  const { parentPath } = path
  if (!parentPath) {
    return false
  }
  const parent = parentPath.node
  const { node } = path
  if (t.isAssignmentExpression(parent) && parent.left === node) {
    return true
  }
  if (t.isUpdateExpression(parent) && parent.argument === node) {
    return true
  }
  if (t.isUnaryExpression(parent) && parent.operator === 'delete') {
    return true
  }
  if ((t.isForInStatement(parent) || t.isForOfStatement(parent)) && parent.left === node) {
    return true
  }
  if (t.isArrayPattern(parent)) {
    return true
  }
  if (t.isRestElement(parent) && parent.argument === node) {
    return true
  }
  if (t.isAssignmentPattern(parent) && parent.left === node) {
    return true
  }
  if (t.isObjectProperty(parent) && parent.value === node) {
    const grandparent = parentPath.parentPath
    return grandparent != null && grandparent.isObjectPattern()
  }
  return false
}

// Folding a leading call to a string can create a directive and change strictness.
function foldsIntoDirective(path: NodePath<t.CallExpression>, replacement: t.Expression): boolean {
  if (!t.isStringLiteral(replacement)) {
    return false
  }
  const { parentPath } = path
  return (
    parentPath != null && parentPath.isExpressionStatement() && isInDirectivePrologue(parentPath)
  )
}

function handleCall(path: NodePath<t.CallExpression>, patchedRoots: Set<string>): void {
  // `with` and direct eval can shadow names outside Babel's scope table.
  if (isInsideWith(path) || enclosingScopeHasDirectEval(path)) {
    return
  }
  const { callee } = path.node

  if (t.isIdentifier(callee)) {
    foldGlobalCall(path, callee.name, patchedRoots)
    return
  }

  if (!t.isMemberExpression(callee)) {
    return
  }
  const propName = staticPropertyName(callee)
  if (propName === null) {
    return
  }
  const obj = callee.object
  if (t.isSuper(obj)) {
    return
  }

  if (t.isIdentifier(obj)) {
    foldNamespaceCall(path, obj.name, propName, patchedRoots)
    if (!t.isCallExpression(path.node)) {
      return
    }
  }
  foldReceiverCall(path, obj, propName, patchedRoots)
}

function handleMember(path: NodePath<t.MemberExpression>, patchedRoots: Set<string>): void {
  const propName = staticPropertyName(path.node)
  if (propName === null) {
    return
  }

  const { parent } = path
  // Calls use their own folding path.
  if (
    (t.isCallExpression(parent) ||
      t.isOptionalCallExpression(parent) ||
      t.isNewExpression(parent)) &&
    parent.callee === path.node
  ) {
    return
  }
  if (isReferenceRequiredPosition(path)) {
    return
  }
  // Delay the ancestor walk until cheap shape checks pass.
  if (isInsideWith(path) || enclosingScopeHasDirectEval(path)) {
    return
  }

  const obj = path.node.object

  if (t.isIdentifier(obj) && !path.scope.getBinding(obj.name) && !patchedRoots.has(obj.name)) {
    if (obj.name === 'Math') {
      const value = MATH_CONSTANTS.get(propName)
      if (value !== undefined) {
        const lit = valueToLiteral(value)
        if (lit) {
          path.replaceWith(lit)
        }
      }
      return
    }
    if (obj.name === 'Number') {
      const value = NUMBER_CONSTANTS.get(propName)
      if (value !== undefined) {
        const lit = valueToLiteral(value)
        if (lit) {
          path.replaceWith(lit)
        }
      }
      return
    }
  }

  if (propName === 'length') {
    const recv = evaluateConstant(obj, path.scope, path)
    if (recv.known && typeof recv.value === 'string') {
      path.replaceWith(t.numericLiteral(recv.value.length))
    }
  }
}

function foldGlobalCall(
  path: NodePath<t.CallExpression>,
  name: string,
  patchedRoots: Set<string>,
): void {
  if (patchedRoots.has(name)) {
    return
  }
  if (name === 'Boolean') {
    if (path.scope.getBinding('Boolean')) {
      return
    }
    foldBooleanCtor(path)
    return
  }
  if (name === 'String') {
    if (path.scope.getBinding('String')) {
      return
    }
    foldStringCtor(path)
    return
  }
  if (name === 'Number') {
    if (path.scope.getBinding('Number')) {
      return
    }
    foldNumberCtor(path)
    return
  }

  if (GLOBAL_FUNCTIONS.has(name)) {
    if (path.scope.getBinding(name)) {
      return
    }
    const fn = (globalThis as unknown as Record<string, unknown>)[name]
    if (typeof fn !== 'function') {
      return
    }
    foldByReflection(path, fn as (...args: unknown[]) => unknown)
  }
}

function foldNamespaceCall(
  path: NodePath<t.CallExpression>,
  ns: string,
  member: string,
  patchedRoots: Set<string>,
): void {
  if (path.scope.getBinding(ns) || patchedRoots.has(ns)) {
    return
  }

  if (ns === 'Math') {
    if (member === 'pow') {
      foldMathPow(path)
      return
    }
    if (MATH_FUNCTIONS.has(member)) {
      foldByReflection(
        path,
        (Math as unknown as Record<string, (...a: unknown[]) => unknown>)[member],
      )
    }
    return
  }
  if (ns === 'String') {
    if (STRING_NS_FUNCTIONS.has(member)) {
      foldByReflection(
        path,
        (String as unknown as Record<string, (...a: unknown[]) => unknown>)[member],
      )
    }
    return
  }
  if (ns === 'Number') {
    if (NUMBER_NS_FUNCTIONS.has(member)) {
      foldByReflection(
        path,
        (Number as unknown as Record<string, (...a: unknown[]) => unknown>)[member],
      )
    }
    return
  }
  if (ns === 'Array') {
    if (member === 'of') {
      foldArrayOf(path)
      return
    }
    if (member === 'isArray') {
      foldArrayIsArray(path)
    }
  }
}

function foldReceiverCall(
  path: NodePath<t.CallExpression>,
  receiverNode: t.Expression,
  method: string,
  patchedRoots: Set<string>,
): void {
  const recv = evaluateConstant(receiverNode, path.scope, path)
  if (!recv.known) {
    return
  }
  const { value } = recv

  if (typeof value === 'string') {
    if (!STRING_PROTOTYPE_METHODS.has(method) || patchedRoots.has('String')) {
      return
    }
    foldPrototypeCall(path, value, method)
    return
  }
  if (typeof value === 'number') {
    if (!NUMBER_PROTOTYPE_METHODS.has(method) || patchedRoots.has('Number')) {
      return
    }
    foldPrototypeCall(path, value, method)
    return
  }
  if (typeof value === 'boolean') {
    if (!BOOLEAN_PROTOTYPE_METHODS.has(method) || patchedRoots.has('Boolean')) {
      return
    }
    foldPrototypeCall(path, value, method)
    return
  }
  if (typeof value === 'bigint') {
    if (!BIGINT_PROTOTYPE_METHODS.has(method) || patchedRoots.has('BigInt')) {
      return
    }
    foldPrototypeCall(path, value, method)
  }
}

function foldMathPow(path: NodePath<t.CallExpression>): void {
  const args = path.node.arguments
  if (args.length !== 2) {
    return
  }
  const [left, right] = args
  if (!t.isExpression(left) || !t.isExpression(right)) {
    return
  }
  // `Math.pow` rejects two BigInt operands while `**` returns a BigInt. A known
  // Number operand makes mixed BigInt input throw in both forms.
  if (!operandIsNumber(left, path) && !operandIsNumber(right, path)) {
    return
  }
  path.replaceWith(t.binaryExpression('**', left, right))
}

function operandIsNumber(node: t.Expression, path: NodePath<t.CallExpression>): boolean {
  if (t.isNumericLiteral(node)) {
    return true
  }
  // Unary plus produces a Number or throws before exponentiation.
  if (t.isUnaryExpression(node) && node.operator === '+') {
    return true
  }
  const evaluated = evaluateConstant(node, path.scope, path)
  return evaluated.known && typeof evaluated.value === 'number'
}

function foldArrayOf(path: NodePath<t.CallExpression>): void {
  const args = path.node.arguments
  const elements: (t.Expression | t.SpreadElement | null)[] = []
  for (const arg of args) {
    if (t.isExpression(arg) || t.isSpreadElement(arg)) {
      elements.push(arg)
      continue
    }
    return
  }
  path.replaceWith(t.arrayExpression(elements))
}

function foldArrayIsArray(path: NodePath<t.CallExpression>): void {
  const args = path.node.arguments
  if (args.length !== 1) {
    return
  }
  const [arg] = args
  if (!t.isExpression(arg)) {
    return
  }
  // A known scalar cannot be an array.
  const evaluated = evaluateConstant(arg, path.scope, path)
  if (!evaluated.known) {
    return
  }
  const { value } = evaluated
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value === null ||
    value === undefined
  ) {
    path.replaceWith(t.booleanLiteral(false))
  }
}

function foldBooleanCtor(path: NodePath<t.CallExpression>): void {
  const args = path.node.arguments
  if (args.length === 0) {
    path.replaceWith(t.booleanLiteral(false))
    return
  }
  if (args.length !== 1) {
    return
  }
  const [arg] = args
  if (!t.isExpression(arg)) {
    return
  }
  path.replaceWith(t.unaryExpression('!', t.unaryExpression('!', arg)))
}

function foldStringCtor(path: NodePath<t.CallExpression>): void {
  const args = path.node.arguments
  if (args.length === 0) {
    const empty = t.stringLiteral('')
    if (!foldsIntoDirective(path, empty)) {
      path.replaceWith(empty)
    }
    return
  }
  if (args.length !== 1) {
    return
  }
  const [arg] = args
  if (!t.isExpression(arg)) {
    return
  }
  const evaluated = evaluateConstant(arg, path.scope, path)
  if (!evaluated.known || isOpaque(evaluated.value)) {
    return
  }
  let result: string
  try {
    result = String(evaluated.value)
  } catch {
    return
  }
  const lit = valueToLiteral(result)
  if (!lit || foldsIntoDirective(path, lit)) {
    return
  }
  path.replaceWith(lit)
}

function foldNumberCtor(path: NodePath<t.CallExpression>): void {
  const args = path.node.arguments
  if (args.length === 0) {
    path.replaceWith(t.numericLiteral(0))
    return
  }
  if (args.length !== 1) {
    return
  }
  const [arg] = args
  if (!t.isExpression(arg)) {
    return
  }
  const evaluated = evaluateConstant(arg, path.scope, path)
  if (!evaluated.known || isOpaque(evaluated.value)) {
    return
  }
  let result: number
  try {
    // BigInt conversion throws outside the safe-integer range.
    result = Number(evaluated.value as never)
  } catch {
    return
  }
  const lit = valueToLiteral(result)
  if (!lit) {
    return
  }
  path.replaceWith(lit)
}

function foldByReflection(
  path: NodePath<t.CallExpression>,
  fn: ((...a: unknown[]) => unknown) | undefined,
): void {
  if (typeof fn !== 'function') {
    return
  }
  const args = tryEvaluateArgs(path.node.arguments, path)
  if (args === null) {
    return
  }
  let result: unknown
  try {
    result = fn(...args)
  } catch {
    return
  }
  const lit = valueToLiteral(result)
  if (!lit || foldsIntoDirective(path, lit)) {
    return
  }
  path.replaceWith(lit)
}

function foldPrototypeCall(
  path: NodePath<t.CallExpression>,
  receiver: unknown,
  method: string,
): void {
  const args = tryEvaluateArgs(path.node.arguments, path)
  if (args === null) {
    return
  }
  let result: unknown
  try {
    const fn = (receiver as unknown as Record<string, unknown>)[method]
    if (typeof fn !== 'function') {
      return
    }
    result = (fn as (...a: unknown[]) => unknown).apply(receiver, args)
  } catch {
    return
  }
  const lit = valueToLiteral(result)
  if (!lit || foldsIntoDirective(path, lit)) {
    return
  }
  path.replaceWith(lit)
}

function tryEvaluateArgs(
  args: t.CallExpression['arguments'],
  path: NodePath<t.CallExpression>,
): unknown[] | null {
  const result: unknown[] = []
  for (const arg of args) {
    if (!t.isExpression(arg)) {
      return null
    }
    const evaluated = evaluateConstant(arg, path.scope, path)
    if (!evaluated.known || isOpaque(evaluated.value)) {
      return null
    }
    result.push(evaluated.value)
  }
  return result
}
