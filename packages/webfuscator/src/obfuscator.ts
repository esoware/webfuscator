import generate from '@babel/generator'
import { parse } from '@babel/parser'
import type { ParserOptions } from '@babel/parser'
import type { File } from '@babel/types'

import type { ObfuscatorOptions, TransformContext, TransformName } from './options'
import { dotToBracket } from './preparation/dot-to-bracket'
import { expandDestructuring } from './preparation/expand-destructuring'
import { expandTemplateLiterals } from './preparation/expand-template-literals'
import { splitSequenceExpressions } from './preparation/split-sequence-expressions'
import { splitVariableDeclarations } from './preparation/split-variable-declarations'
import { stringifyObjectKeys } from './preparation/stringify-object-keys'
import { wrapSingleStatements } from './preparation/wrap-single-statements'
import { argumentsToParameters } from './transforms/arguments-to-parameters'
import { arrowToFunction } from './transforms/arrow-to-function'
import { collapseSingleUseTemps } from './transforms/collapse-single-use-temps'
import { constLetToVar } from './transforms/const-let-to-var'
import { constToLet } from './transforms/const-to-let'
import { doWhileToWhile } from './transforms/do-while-to-while'
import { dropConsole } from './transforms/drop-console'
import { dropDebugger } from './transforms/drop-debugger'
import { expandBinaryAssignment } from './transforms/expand-binary-assignment'
import { expandLogicalAssignment } from './transforms/expand-logical-assignment'
import { extractObjectProperties } from './transforms/extract-object-properties'
import { foldBuiltinMethods } from './transforms/fold-builtin-methods'
import { foldConstants } from './transforms/fold-constants'
import { forToWhile } from './transforms/for-to-while'
import { functionDeclarationToExpression } from './transforms/function-declaration-to-expression'
import { inlineFunctions } from './transforms/inline-functions'
import { logicalToTernary } from './transforms/logical-to-ternary'
import { mangleProperties } from './transforms/mangle-properties'
import { nullishCoalescingToTernary } from './transforms/nullish-coalescing-to-ternary'
import { numbersToStrings } from './transforms/numbers-to-strings'
import { objectMethodToProperty } from './transforms/object-method-to-property'
import { optionalChainingToTernary } from './transforms/optional-chaining-to-ternary'
import { pack } from './transforms/pack'
import { packDeclarationsIntoParameters } from './transforms/pack-declarations-into-parameters'
import { removeAnonymousFunctionNames } from './transforms/remove-anonymous-function-names'
import { removeUnreachableCode } from './transforms/remove-unreachable-code'
import { removeUnusedCode } from './transforms/remove-unused-code'
import { renameIdentifiers } from './transforms/rename-identifiers'
import { specialsToStrings } from './transforms/specials-to-strings'
import { switchToIf } from './transforms/switch-to-if'
import { ternaryToIf } from './transforms/ternary-to-if'
import { updateToAssignment } from './transforms/update-to-assignment'
import { yodifyConditions } from './transforms/yodify-conditions'
import type { StringGeneratorModeOption } from './utils/string-generator'

const parserOptions: ParserOptions = { sourceType: 'unambiguous' }

const PRESERVED_COMMENT_RE = /^!|@(?:license|preserve)\b|^#\s*source(?:Mapping)?URL=/iu

const DEFAULT_STRING_GENERATOR_MODE: StringGeneratorModeOption = 'mangled'
const DEFAULT_SEED = 0

// Real inputs settle in a handful of iterations. Hitting this cap signals an
// algorithmic bug; never raise it as a workaround.
const FIXED_POINT_ITERATION_CAP = 10

type TransformFn = (ast: File, ctx: TransformContext) => boolean
type Phase = readonly [name: string, fn: TransformFn]
type ConfigurablePhase = readonly [name: TransformName, fn: TransformFn]

// Mangling must see quoted access before preparation erases that distinction.
// It is opt-in because outside code may use the same properties.
const BEFORE_PREPARATION: readonly ConfigurablePhase[] = [['mangleProperties', mangleProperties]]

// Shape-normalizing passes. Always run; never exposed in `options.transforms`.
const PREPARATION: readonly Phase[] = [
  ['expandDestructuring', asBoolean(expandDestructuring)],
  ['wrapSingleStatements', asBoolean(wrapSingleStatements)],
  ['splitSequenceExpressions', asBoolean(splitSequenceExpressions)],
  ['splitVariableDeclarations', asBoolean(splitVariableDeclarations)],
  ['expandTemplateLiterals', asBoolean(expandTemplateLiterals)],
  ['stringifyObjectKeys', asBoolean(stringifyObjectKeys)],
  ['dotToBracket', asBoolean(dotToBracket)],
]

// These one-shot passes prepare the fixed point. Lexical declarations become
// foldable function-scoped bindings, except at script top level where `var`
// would create a global property. `argumentsToParameters` precedes parameter
// renaming. Method demotion precedes extraction because any surviving
// `ObjectMethod` makes extraction refuse the whole literal.
const PRE_LOOP: readonly ConfigurablePhase[] = [
  ['dropDebugger', dropDebugger],
  ['dropConsole', dropConsole],
  ['constToLet', constToLet],
  ['constLetToVar', constLetToVar],
  ['argumentsToParameters', argumentsToParameters],
  ['objectMethodToProperty', objectMethodToProperty],
]

// Folds, removals, extraction, and inlining expose work for one another. Stop
// when a full round makes no change.
const FIXED_POINT: readonly ConfigurablePhase[] = [
  ['foldConstants', foldConstants],
  ['foldBuiltinMethods', foldBuiltinMethods],
  ['extractObjectProperties', extractObjectProperties],
  ['inlineFunctions', inlineFunctions],
  ['removeUnreachableCode', removeUnreachableCode],
  ['removeUnusedCode', removeUnusedCode],
  ['removeAnonymousFunctionNames', removeAnonymousFunctionNames],
  ['collapseSingleUseTemps', collapseSingleUseTemps],
]

// Lowerings run from producer to consumer. Arrow capture lands before code can
// move out of an arrow. Function declarations remain available to the inliner
// until the fixed point ends. Loop passes converge on `while`. Updates become
// compound assignments before binary assignment expansion. Logical assignment,
// optional chaining, nullish coalescing, logical expressions, and ternaries then
// lower in that order.
const LOWERING: readonly ConfigurablePhase[] = [
  ['arrowToFunction', arrowToFunction],
  ['functionDeclarationToExpression', functionDeclarationToExpression],
  ['switchToIf', switchToIf],
  ['forToWhile', forToWhile],
  ['doWhileToWhile', doWhileToWhile],
  ['updateToAssignment', updateToAssignment],
  ['expandBinaryAssignment', expandBinaryAssignment],
  ['expandLogicalAssignment', expandLogicalAssignment],
  ['optionalChainingToTernary', optionalChainingToTernary],
  ['nullishCoalescingToTernary', nullishCoalescingToTernary],
  ['logicalToTernary', logicalToTernary],
  ['ternaryToIf', ternaryToIf],
]

// Yodification and folding need raw numeric literals. Special-value lowering
// comes next, then number lowering also handles the `1` created for `Infinity`.
const POST_PROCESS: readonly ConfigurablePhase[] = [
  ['packDeclarationsIntoParameters', packDeclarationsIntoParameters],
  ['yodifyConditions', yodifyConditions],
  ['specialsToStrings', specialsToStrings],
  ['numbersToStrings', numbersToStrings],
]

// Renaming runs last because later transforms depend on recognizable bindings.
const RENAME: readonly ConfigurablePhase[] = [['renameIdentifiers', renameIdentifiers]]

// Packing serializes the finished program to a string and rebuilds it through
// the Function constructor. It must see final names and shapes, so it runs after
// every other rewrite, including renaming.
const PACK: readonly ConfigurablePhase[] = [['pack', pack]]

/** Parses, transforms, and prints JavaScript without mutating external state. */
export function obfuscate(code: string, options: ObfuscatorOptions = {}): string {
  const log = options.verbose ? makeLogger() : null
  const baseCtx: TransformContext = {
    seed: options.seed ?? DEFAULT_SEED,
    stringGeneratorMode: options.stringGeneratorMode ?? DEFAULT_STRING_GENERATOR_MODE,
  }
  const ast = run(log, 'parse', () => parse(code, parserOptions))

  for (const [name, fn] of BEFORE_PREPARATION) {
    if (!isEnabled(name, options)) {
      continue
    }
    run(log, name, () => fn(ast, ctxFor(name, options, baseCtx)))
  }

  for (const [name, fn] of PREPARATION) {
    run(log, name, () => fn(ast, baseCtx))
  }

  for (const [name, fn] of PRE_LOOP) {
    if (!isEnabled(name, options)) {
      continue
    }
    run(log, name, () => fn(ast, ctxFor(name, options, baseCtx)))
  }

  runFixedPoint(ast, options, baseCtx, log)

  for (const [name, fn] of LOWERING) {
    if (!isEnabled(name, options)) {
      continue
    }
    run(log, name, () => fn(ast, ctxFor(name, options, baseCtx)))
  }

  for (const [name, fn] of POST_PROCESS) {
    if (!isEnabled(name, options)) {
      continue
    }
    run(log, name, () => fn(ast, ctxFor(name, options, baseCtx)))
  }

  for (const [name, fn] of RENAME) {
    if (!isEnabled(name, options)) {
      continue
    }
    run(log, name, () => fn(ast, ctxFor(name, options, baseCtx)))
  }

  for (const [name, fn] of PACK) {
    if (!isEnabled(name, options)) {
      continue
    }
    run(log, name, () => fn(ast, ctxFor(name, options, baseCtx)))
  }

  return run(
    log,
    'generate',
    () => generate(ast, { minified: options.minify ?? false, shouldPrintComment }).code,
  )
}

function isEnabled(name: TransformName, options: ObfuscatorOptions): boolean {
  const entry = options.transforms?.[name]
  return entry !== undefined && entry !== false
}

// Boolean entries inherit the base. An override replaces its string mode.
function ctxFor(
  name: TransformName,
  options: ObfuscatorOptions,
  base: TransformContext,
): TransformContext {
  const entry = options.transforms?.[name]
  let context = base
  if (entry && typeof entry === 'object' && entry.stringGeneratorMode !== undefined) {
    context = { ...base, stringGeneratorMode: entry.stringGeneratorMode }
  }
  if (name === 'mangleProperties' && entry && typeof entry === 'object') {
    return { ...context, mangleProperties: entry }
  }
  if (name === 'pack' && entry && typeof entry === 'object') {
    return { ...context, pack: entry }
  }
  return context
}

function runFixedPoint(
  ast: File,
  options: ObfuscatorOptions,
  ctx: TransformContext,
  log: Logger | null,
): void {
  const enabled = FIXED_POINT.filter(([name]) => isEnabled(name, options))
  if (enabled.length === 0) {
    return
  }

  for (let iter = 0; iter < FIXED_POINT_ITERATION_CAP; iter++) {
    let any = false
    for (const [name, fn] of enabled) {
      if (run(log, name, () => fn(ast, ctx))) {
        any = true
      }
    }
    if (!any) {
      return
    }
  }
}

function asBoolean(fn: (ast: File) => unknown): TransformFn {
  return (ast) => {
    fn(ast)
    return false
  }
}

function shouldPrintComment(value: string): boolean {
  return PRESERVED_COMMENT_RE.test(value)
}

type Logger = <T>(name: string, fn: () => T) => T

function run<T>(log: Logger | null, name: string, fn: () => T): T {
  return log ? log(name, fn) : fn()
}

function makeLogger(): Logger {
  const t0 = performance.now()
  const stamp = (): string => `[${(performance.now() - t0).toFixed(0).padStart(6)}ms]`
  return (name, fn) => {
    console.error(`${stamp()} > ${name}`)
    const start = performance.now()
    const result = fn()
    console.error(`${stamp()} < ${name} (${(performance.now() - start).toFixed(1)}ms)`)
    return result
  }
}
