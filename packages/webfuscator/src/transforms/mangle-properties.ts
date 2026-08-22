import traverse from '@babel/traverse'
import type { NodePath, Scope, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { evaluateConstant, isOpaque } from '../analysis/constant'
import type { ManglePropertiesOptions, PropertyNameGenerator, TransformContext } from '../options'
import { isProtoKey } from '../utils/ast'
import type { ChangeState } from '../utils/change-tracking'
import { DOM_PROPERTIES } from '../utils/dom-properties'
import { mulberry32 } from '../utils/random'
import { StringGenerator } from '../utils/string-generator'

/**
 * Renames statically known public properties through one program-wide mapping.
 * Property selection follows Terser, with extra collision checks for names
 * that this pipeline must leave unchanged.
 *
 * This pass runs before shape preparation, while Babel still distinguishes
 * `obj.name` from `obj["name"]`.
 *
 * @example
 * // ◀️ before
 * var counter = {
 *   current_: 1,
 *   increment_() { return ++this.current_; }
 * };
 * log(counter.increment_());
 *
 * // ▶️ after
 * var counter = {
 *   a: 1,
 *   b() { return ++this.a; }
 * };
 * log(counter.b());
 */
export function mangleProperties(ast: File, ctx: TransformContext): boolean {
  const state = new PropertyManglerState(ctx)
  traverse(ast, prepareVisitor, undefined, state)
  traverse(ast, collectVisitor, undefined, state)
  state.finalizeCandidates()
  traverse(ast, rewriteVisitor, undefined, state)
  return state.changed
}

const MANGLE_PROPERTY_ANNOTATION = '__MANGLE_PROP__'
const PROPERTY_KEY_ANNOTATION = '__KEY__'
const NUMERIC_PROPERTY_RE = /^-?[0-9]+(?:\.[0-9]+)?(?:e[+-][0-9]+)?$/u
const SYNTAX_SENSITIVE_GENERATED_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_GENERATOR_ATTEMPTS = 100_000

/**
 * Names a platform object may own wherever the output runs. That could be a
 * browser, a Node process, or an embedded engine, and nothing here can tell
 * which, so the table unions every host name Terser collected. Renaming a name
 * the target owns breaks the program. Reserving one it does not own costs a
 * single missed rename.
 *
 * `builtins: true` is the caller promising that none of these names reach a
 * platform object in their target.
 */
const RESERVED_PROPERTIES: ReadonlySet<string> = new Set([
  ...DOM_PROPERTIES,
  // V8 reads `Error.prepareStackTrace` back off the constructor, and it postdates the table.
  'prepareStackTrace',
  // Not host names. ES3 rejects a keyword after `.`, which some downstream
  // tooling still enforces, so they stay out of the generated keys too.
  'false',
  'null',
  'true',
])

type KeyedProperty =
  | t.ClassAccessorProperty
  | t.ClassMethod
  | t.ClassProperty
  | t.ObjectMethod
  | t.ObjectProperty

type Member = t.MemberExpression | t.OptionalMemberExpression
type Call = t.CallExpression | t.OptionalCallExpression

class PropertyManglerState implements ChangeState {
  changed = false
  readonly annotated = new Set<string>()
  readonly candidates = new Set<string>()
  readonly cache: Map<string, string>
  readonly keepQuoted: boolean | 'strict'
  readonly onlyAnnotated: boolean
  readonly onlyCache: boolean
  readonly reserved: Set<string>
  readonly rewrittenKeyAnnotations = new WeakSet<t.StringLiteral>()
  readonly undeclared: boolean

  private readonly blockedCacheSources = new Set<string>()
  private readonly debugSuffix: string | null
  private readonly emittedNames = new Set<string>()
  private readonly nameGenerator: PropertyNameGenerator
  private readonly regex: RegExp | null
  private readonly skippedUndeclaredNames = new Set<string>()
  private readonly unavailableOutputs = new Set<string>()
  private nameIndex = 0

  constructor(ctx: TransformContext) {
    const options = ctx.mangleProperties ?? {}
    this.cache = options.cache ?? new Map()
    this.keepQuoted = options.keepQuoted ?? false
    this.onlyAnnotated = options.onlyAnnotated ?? false
    this.onlyCache = options.onlyCache ?? false
    this.reserved = new Set(options.reserved)
    this.undeclared = options.undeclared ?? false
    this.debugSuffix = debugSuffix(options.debug)
    this.regex = compileRegex(options.regex)

    if (!options.builtins) {
      for (const name of RESERVED_PROPERTIES) {
        this.reserved.add(name)
      }
    }

    const cachedNames = new Set<string>()
    for (const [name, mangled] of this.cache) {
      if (typeof name !== 'string' || typeof mangled !== 'string') {
        throw new TypeError('mangleProperties.cache must map strings to strings')
      }
      if (SYNTAX_SENSITIVE_GENERATED_NAMES.has(mangled)) {
        throw new TypeError(`mangleProperties.cache cannot emit ${JSON.stringify(mangled)}`)
      }
      if (cachedNames.has(mangled)) {
        throw new TypeError(
          `mangleProperties.cache contains duplicate output ${JSON.stringify(mangled)}`,
        )
      }
      cachedNames.add(mangled)
      this.emittedNames.add(mangled)
    }

    if (options.nameGenerator) {
      this.nameGenerator = options.nameGenerator
    } else {
      const generator = new StringGenerator(ctx.stringGeneratorMode, mulberry32(ctx.seed))
      this.nameGenerator = (index) => generator.at(index)
    }
  }

  addCandidate(name: string): void {
    if (this.canSelect(name)) {
      this.candidates.add(name)
    }
    if (!this.shouldMangle(name)) {
      this.unavailableOutputs.add(name)
    }
  }

  retainName(name: string): void {
    this.unavailableOutputs.add(name)
  }

  reserveName(name: string): void {
    this.reserved.add(name)
    this.unavailableOutputs.add(name)
  }

  skipUndeclaredName(name: string): void {
    this.skippedUndeclaredNames.add(name)
  }

  finalizeCandidates(): void {
    for (const name of this.skippedUndeclaredNames) {
      if (!this.shouldMangle(name)) {
        this.unavailableOutputs.add(name)
      }
    }

    const sourceByOutput = new Map<string, string>()
    for (const [source, output] of this.cache) {
      if (source === output || !this.shouldMangle(source)) {
        continue
      }
      sourceByOutput.set(output, source)
    }

    // A blocked endpoint in a cached rename chain makes every predecessor
    // unsafe too, since its output would collide with the retained source.
    const pending = [...this.unavailableOutputs]
    for (const output of pending) {
      const source = sourceByOutput.get(output)
      if (source === undefined || this.blockedCacheSources.has(source)) {
        continue
      }
      this.blockedCacheSources.add(source)
      if (!this.unavailableOutputs.has(source)) {
        this.unavailableOutputs.add(source)
        pending.push(source)
      }
    }
  }

  mangle(name: string): string {
    if (!this.shouldMangle(name)) {
      return name
    }

    const cached = this.cache.get(name)
    if (cached !== undefined || this.cache.has(name)) {
      return cached!
    }

    let mangled = this.debugName(name)
    if (mangled === null) {
      mangled = this.nextGeneratedName()
    }
    this.cache.set(name, mangled)
    this.emittedNames.add(mangled)
    return mangled
  }

  private canSelect(name: string): boolean {
    if (this.reserved.has(name)) {
      return false
    }
    if (this.onlyCache) {
      return this.cache.has(name)
    }
    return !NUMERIC_PROPERTY_RE.test(name)
  }

  private debugName(name: string): string | null {
    if (this.debugSuffix === null) {
      return null
    }
    const candidate = `_$${name}$${this.debugSuffix}_`
    return this.isAvailableOutput(candidate) ? candidate : null
  }

  private matchesRegex(name: string): boolean {
    if (this.regex === null) {
      return true
    }
    this.regex.lastIndex = 0
    return this.regex.test(name)
  }

  private nextGeneratedName(): string {
    for (let attempt = 0; attempt < MAX_GENERATOR_ATTEMPTS; attempt++) {
      const candidate = this.nameGenerator(this.nameIndex++)
      if (typeof candidate !== 'string') {
        throw new TypeError('mangleProperties.nameGenerator must return a string')
      }
      if (this.isAvailableOutput(candidate)) {
        return candidate
      }
    }
    throw new Error('mangleProperties.nameGenerator did not produce an available name')
  }

  private shouldMangle(name: string): boolean {
    if (this.blockedCacheSources.has(name)) {
      return false
    }
    if (this.onlyAnnotated && !this.annotated.has(name)) {
      return false
    }
    if (!this.matchesRegex(name) && !this.annotated.has(name)) {
      return false
    }
    if (this.reserved.has(name)) {
      return false
    }
    return this.cache.has(name) || this.candidates.has(name)
  }

  private isAvailableOutput(name: string): boolean {
    return (
      !SYNTAX_SENSITIVE_GENERATED_NAMES.has(name) &&
      !NUMERIC_PROPERTY_RE.test(name) &&
      !this.emittedNames.has(name) &&
      !this.reserved.has(name) &&
      !this.unavailableOutputs.has(name)
    )
  }
}

const prepareVisitor: Visitor<PropertyManglerState> = {
  enter(path, state) {
    if (isKeyedProperty(path.node)) {
      prepareKeyedProperty(path as NodePath<KeyedProperty>, state)
      return
    }
    if (t.isMemberExpression(path.node) || t.isOptionalMemberExpression(path.node)) {
      prepareMember(path as NodePath<Member>, state)
    }
  },
}

const collectVisitor: Visitor<PropertyManglerState> = {
  enter(path, state) {
    if (isKeyedProperty(path.node)) {
      collectKeyedProperty(path as NodePath<KeyedProperty>, state)
      return
    }
    if (t.isMemberExpression(path.node) || t.isOptionalMemberExpression(path.node)) {
      collectMember(path as NodePath<Member>, state)
      return
    }
    if (t.isBinaryExpression(path.node) && path.node.operator === 'in') {
      if (t.isExpression(path.node.left)) {
        collectTerminalNames(path.node.left, path.scope, path, state)
      }
      return
    }
    if (
      (t.isCallExpression(path.node) || t.isOptionalCallExpression(path.node)) &&
      isObjectDefinePropertyCall(path as NodePath<Call>)
    ) {
      const key = path.node.arguments[1]
      if (key && t.isExpression(key)) {
        collectTerminalNames(key, path.scope, path, state)
      }
      return
    }
    if (t.isStringLiteral(path.node) && hasAnnotation(path.node, PROPERTY_KEY_ANNOTATION)) {
      state.addCandidate(path.node.value)
    }
  },
}

const rewriteVisitor: Visitor<PropertyManglerState> = {
  enter(path, state) {
    if (isKeyedProperty(path.node)) {
      rewriteKeyedProperty(path as NodePath<KeyedProperty>, state)
      return
    }
    if (t.isMemberExpression(path.node) || t.isOptionalMemberExpression(path.node)) {
      rewriteMember(path as NodePath<Member>, state)
      return
    }
    if (t.isBinaryExpression(path.node) && path.node.operator === 'in') {
      if (t.isExpression(path.node.left)) {
        path.node.left = rewriteTerminalNames(path.node.left, path.scope, path, state)
      }
      return
    }
    if (
      (t.isCallExpression(path.node) || t.isOptionalCallExpression(path.node)) &&
      isObjectDefinePropertyCall(path as NodePath<Call>)
    ) {
      const key = path.node.arguments[1]
      if (key && t.isExpression(key)) {
        path.node.arguments[1] = rewriteTerminalNames(key, path.scope, path, state)
      }
      return
    }
    if (
      t.isStringLiteral(path.node) &&
      hasAnnotation(path.node, PROPERTY_KEY_ANNOTATION) &&
      !state.rewrittenKeyAnnotations.has(path.node)
    ) {
      rewriteString(path.node, state)
    }
  },
}

function prepareKeyedProperty(path: NodePath<KeyedProperty>, state: PropertyManglerState): void {
  const node = path.node
  if (isSemanticKey(node)) {
    const name = plainKeyName(node.key)
    if (name !== null) {
      state.reserveName(name)
    }
  }
  if (state.keepQuoted) {
    protectQuotedKey(path, state)
  }
  if (
    hasAnnotation(node, MANGLE_PROPERTY_ANNOTATION) ||
    hasAnnotation(node.key, MANGLE_PROPERTY_ANNOTATION)
  ) {
    addAnnotatedKey(path, state)
  }
}

function prepareMember(path: NodePath<Member>, state: PropertyManglerState): void {
  const node = path.node
  if (state.keepQuoted && node.computed && t.isExpression(node.property)) {
    protectTerminalNames(node.property, path.scope, path, state)
  }
  if (memberHasMangleAnnotation(path)) {
    addAnnotatedMember(path, state)
  }
}

function protectQuotedKey(path: NodePath<KeyedProperty>, state: PropertyManglerState): void {
  const node = path.node
  if (node.computed) {
    if (t.isExpression(node.key)) {
      protectTerminalNames(node.key, path.scope, path, state)
    }
  } else if (t.isStringLiteral(node.key)) {
    protectName(node.key.value, state)
  }
}

function protectTerminalNames(
  node: t.Expression,
  scope: Scope,
  referencePath: NodePath,
  state: PropertyManglerState,
): void {
  forEachTerminalName(node, scope, referencePath, (name) => protectName(name, state))
}

function protectName(name: string, state: PropertyManglerState): void {
  if (state.keepQuoted === true) {
    state.reserveName(name)
  } else {
    state.retainName(name)
  }
}

function addAnnotatedKey(path: NodePath<KeyedProperty>, state: PropertyManglerState): void {
  const node = path.node
  if (node.computed) {
    if (t.isExpression(node.key)) {
      forEachTerminalName(node.key, path.scope, path, (name) => state.annotated.add(name))
    }
    return
  }
  const name = plainKeyName(node.key)
  if (name !== null) {
    state.annotated.add(name)
  }
}

function addAnnotatedMember(path: NodePath<Member>, state: PropertyManglerState): void {
  const node = path.node
  if (node.computed) {
    if (t.isExpression(node.property)) {
      forEachTerminalName(node.property, path.scope, path, (name) => state.annotated.add(name))
    }
  } else if (t.isIdentifier(node.property)) {
    state.annotated.add(node.property.name)
  }
}

function collectKeyedProperty(path: NodePath<KeyedProperty>, state: PropertyManglerState): void {
  const node = path.node
  if (node.computed) {
    if (!state.keepQuoted && t.isExpression(node.key)) {
      collectTerminalNames(node.key, path.scope, path, state)
    }
    return
  }
  if (state.keepQuoted && t.isStringLiteral(node.key)) {
    return
  }
  const name = plainKeyName(node.key)
  if (name !== null) {
    state.addCandidate(name)
  }
}

function collectMember(path: NodePath<Member>, state: PropertyManglerState): void {
  const node = path.node
  if (node.computed) {
    if (!state.keepQuoted && t.isExpression(node.property)) {
      collectTerminalNames(node.property, path.scope, path, state)
    }
    return
  }
  if (!state.undeclared && memberRootIsUndeclared(path)) {
    if (t.isIdentifier(node.property)) {
      state.skipUndeclaredName(node.property.name)
    }
    return
  }
  if (t.isIdentifier(node.property)) {
    state.addCandidate(node.property.name)
  }
}

function collectTerminalNames(
  node: t.Expression,
  scope: Scope,
  referencePath: NodePath,
  state: PropertyManglerState,
): void {
  forEachTerminalName(node, scope, referencePath, (name) => state.addCandidate(name))
}

function rewriteKeyedProperty(path: NodePath<KeyedProperty>, state: PropertyManglerState): void {
  const node = path.node
  if (node.computed) {
    if (!state.keepQuoted && t.isExpression(node.key)) {
      node.key = rewriteTerminalNames(node.key, path.scope, path, state)
    }
    return
  }
  if (state.keepQuoted && t.isStringLiteral(node.key)) {
    return
  }
  const name = plainKeyName(node.key)
  if (name === null) {
    return
  }
  const mangled = state.mangle(name)
  if (mangled === name) {
    return
  }
  node.key = t.inheritsComments(t.stringLiteral(mangled), node.key)
  node.computed = false
  if (t.isObjectProperty(node)) {
    node.shorthand = false
  }
  state.changed = true
}

function rewriteMember(path: NodePath<Member>, state: PropertyManglerState): void {
  const node = path.node
  if (node.computed) {
    if (!state.keepQuoted && t.isExpression(node.property)) {
      node.property = rewriteTerminalNames(node.property, path.scope, path, state)
    }
    return
  }
  if (!t.isIdentifier(node.property)) {
    return
  }
  const mangled = state.mangle(node.property.name)
  if (mangled === node.property.name) {
    return
  }
  // Babel narrows members by `computed`, so both fields need widening.
  const computed = node as Member & { computed: boolean; property: t.Expression }
  computed.property = t.inheritsComments(t.stringLiteral(mangled), node.property)
  computed.computed = true
  state.changed = true
}

function rewriteString(node: t.StringLiteral, state: PropertyManglerState): void {
  const mangled = state.mangle(node.value)
  if (mangled !== node.value) {
    node.value = mangled
    state.changed = true
  }
}

function forEachTerminalName(
  node: t.Expression,
  scope: Scope,
  referencePath: NodePath,
  visit: (name: string) => void,
): void {
  const name = evaluatedPropertyName(node, scope, referencePath)
  if (name !== null) {
    visit(name)
    return
  }
  if (t.isSequenceExpression(node)) {
    forEachTerminalName(node.expressions.at(-1)!, scope, referencePath, visit)
  } else if (t.isConditionalExpression(node)) {
    forEachTerminalName(node.consequent, scope, referencePath, visit)
    forEachTerminalName(node.alternate, scope, referencePath, visit)
  } else if (t.isLogicalExpression(node)) {
    forEachTerminalName(node.right, scope, referencePath, visit)
  } else if (t.isParenthesizedExpression(node)) {
    forEachTerminalName(node.expression, scope, referencePath, visit)
  }
}

function rewriteTerminalNames(
  node: t.Expression,
  scope: Scope,
  referencePath: NodePath,
  state: PropertyManglerState,
): t.Expression {
  const name = evaluatedPropertyName(node, scope, referencePath)
  if (name !== null) {
    const mangled = state.mangle(name)
    if (mangled === name) {
      return node
    }
    state.changed = true
    if (t.isStringLiteral(node)) {
      state.rewrittenKeyAnnotations.add(node)
      node.value = mangled
      return node
    }
    return t.inheritsComments(t.stringLiteral(mangled), node)
  }
  if (t.isSequenceExpression(node)) {
    const last = node.expressions.length - 1
    node.expressions[last] = rewriteTerminalNames(
      node.expressions[last]!,
      scope,
      referencePath,
      state,
    )
  } else if (t.isConditionalExpression(node)) {
    node.consequent = rewriteTerminalNames(node.consequent, scope, referencePath, state)
    node.alternate = rewriteTerminalNames(node.alternate, scope, referencePath, state)
  } else if (t.isLogicalExpression(node)) {
    node.right = rewriteTerminalNames(node.right, scope, referencePath, state)
  } else if (t.isParenthesizedExpression(node)) {
    node.expression = rewriteTerminalNames(node.expression, scope, referencePath, state)
  }
  return node
}

function evaluatedPropertyName(
  node: t.Expression,
  scope: Scope,
  referencePath: NodePath,
): string | null {
  const result = evaluateConstant(node, scope, referencePath)
  if (!result.known || isOpaque(result.value) || typeof result.value === 'symbol') {
    return null
  }
  return String(result.value)
}

function memberRootIsUndeclared(path: NodePath<Member>): boolean {
  const root = memberRootIdentifier(path.node)
  return root !== null && path.scope.getBinding(root.name) === undefined
}

function memberRootIdentifier(node: Member): t.Identifier | null {
  let root: t.Node = node.object
  while (true) {
    if (t.isMemberExpression(root) || t.isOptionalMemberExpression(root)) {
      root = root.object
    } else if (t.isCallExpression(root) || t.isOptionalCallExpression(root)) {
      root = root.callee
    } else if (t.isNewExpression(root)) {
      root = root.callee
    } else if (t.isTaggedTemplateExpression(root)) {
      root = root.tag
    } else if (t.isParenthesizedExpression(root)) {
      root = root.expression
    } else {
      break
    }
  }
  return t.isIdentifier(root) ? root : null
}

function memberHasMangleAnnotation(path: NodePath<Member>): boolean {
  if (
    hasAnnotation(path.node, MANGLE_PROPERTY_ANNOTATION) ||
    hasAnnotation(path.node.object, MANGLE_PROPERTY_ANNOTATION) ||
    hasAnnotation(path.node.property, MANGLE_PROPERTY_ANNOTATION)
  ) {
    return true
  }

  let current: NodePath = path
  while (current.parentPath) {
    const parent: NodePath = current.parentPath
    if (parent.isMemberExpression() || parent.isOptionalMemberExpression()) {
      return false
    }
    if (parent.isExpressionStatement() && parent.node.expression === current.node) {
      return hasAnnotation(parent.node, MANGLE_PROPERTY_ANNOTATION)
    }
    if (!isTransparentAnnotationParent(parent, current.node)) {
      return false
    }
    current = parent
  }
  return false
}

function isTransparentAnnotationParent(path: NodePath, child: t.Node): boolean {
  const node = path.node
  return (
    (t.isAssignmentExpression(node) && node.left === child) ||
    (t.isCallExpression(node) && node.callee === child) ||
    (t.isOptionalCallExpression(node) && node.callee === child) ||
    (t.isParenthesizedExpression(node) && node.expression === child) ||
    (t.isUnaryExpression(node) && node.argument === child) ||
    (t.isUpdateExpression(node) && node.argument === child)
  )
}

function hasAnnotation(node: t.Node, annotation: string): boolean {
  return (
    node.leadingComments?.some(
      (comment) =>
        comment.value.includes(`@${annotation}`) || comment.value.includes(`#${annotation}`),
    ) ?? false
  )
}

function isObjectDefinePropertyCall(path: NodePath<Call>): boolean {
  const node = path.node
  const callee = node.callee
  if (
    (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) ||
    !t.isIdentifier(callee.object, { name: 'Object' })
  ) {
    return false
  }
  if (!callee.computed) {
    return t.isIdentifier(callee.property, { name: 'defineProperty' })
  }
  return (
    t.isExpression(callee.property) &&
    evaluatedPropertyName(callee.property, path.scope, path) === 'defineProperty'
  )
}

function isSemanticKey(node: KeyedProperty): boolean {
  return (
    (t.isClassMethod(node) && node.kind === 'constructor') ||
    (t.isObjectProperty(node) && !node.computed && !node.shorthand && isProtoKey(node.key))
  )
}

function isKeyedProperty(node: t.Node): node is KeyedProperty {
  return (
    t.isClassAccessorProperty(node) ||
    t.isClassMethod(node) ||
    t.isClassProperty(node) ||
    t.isObjectMethod(node) ||
    t.isObjectProperty(node)
  )
}

function plainKeyName(key: t.Node): string | null {
  if (t.isIdentifier(key)) {
    return key.name
  }
  if (t.isStringLiteral(key)) {
    return key.value
  }
  if (t.isBooleanLiteral(key)) {
    return String(key.value)
  }
  if (t.isNullLiteral(key)) {
    return 'null'
  }
  if (t.isNumericLiteral(key) || t.isBigIntLiteral(key)) {
    return String(key.value)
  }
  return null
}

function debugSuffix(debug: ManglePropertiesOptions['debug']): string | null {
  if (debug === undefined || debug === false) {
    return null
  }
  return debug === true ? '' : debug
}

function compileRegex(regex: ManglePropertiesOptions['regex']): RegExp | null {
  if (regex === undefined) {
    return null
  }
  if (typeof regex === 'string') {
    // Terser accepts legacy-mode pattern strings; forcing `u` changes their grammar.
    // oxlint-disable-next-line require-unicode-regexp
    return new RegExp(regex)
  }
  return new RegExp(regex.source, regex.flags)
}
