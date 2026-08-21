import type { StringGeneratorModeOption } from 'src/utils/string-generator'

/**
 * Exported transform entry points. Preparation passes are always enabled and
 * do not appear here.
 */
export type TransformName =
  | 'dropConsole'
  | 'dropDebugger'
  | 'constToLet'
  | 'constLetToVar'
  | 'argumentsToParameters'
  | 'objectMethodToProperty'
  | 'foldConstants'
  | 'foldBuiltinMethods'
  | 'extractObjectProperties'
  | 'inlineFunctions'
  | 'removeUnreachableCode'
  | 'removeUnusedCode'
  | 'removeAnonymousFunctionNames'
  | 'collapseSingleUseTemps'
  | 'arrowToFunction'
  | 'functionDeclarationToExpression'
  | 'switchToIf'
  | 'forToWhile'
  | 'doWhileToWhile'
  | 'updateToAssignment'
  | 'expandBinaryAssignment'
  | 'expandLogicalAssignment'
  | 'optionalChainingToTernary'
  | 'nullishCoalescingToTernary'
  | 'logicalToTernary'
  | 'ternaryToIf'
  | 'packDeclarationsIntoParameters'
  | 'yodifyConditions'
  | 'specialsToStrings'
  | 'numbersToStrings'
  | 'mangleProperties'
  | 'renameIdentifiers'
  | 'pack'

// An override enables the transform and replaces its string-generator mode.
type TransformEntry = boolean | { stringGeneratorMode?: StringGeneratorModeOption }

/** Maps a zero-based ordinal to a stable property name. */
export type PropertyNameGenerator = (index: number) => string

/** Terser-compatible property-mangling options using camel-case names. */
export interface ManglePropertiesOptions {
  /** Allow names of JavaScript and DOM builtins to be mangled. Default `false`. */
  builtins?: boolean
  /** Reuse and extend mappings across calls or separately transformed files. */
  cache?: Map<string, string>
  /** Keep the original name visible as `_$name$suffix_`. Default `false`. */
  debug?: boolean | string
  /**
   * Preserve quoted occurrences. `true` also reserves their names globally;
   * `'strict'` lets unquoted occurrences of the same name be mangled.
   */
  keepQuoted?: boolean | 'strict'
  /** Custom property-name generator. It takes precedence over `stringGeneratorMode`. */
  nameGenerator?: PropertyNameGenerator
  /**
   * Only names carrying `/*@__MANGLE_PROP__*\/` or `/*#__MANGLE_PROP__*\/` may
   * be mangled. Default `false`.
   */
  onlyAnnotated?: boolean
  /** Only names already present in `cache` may be mangled. Default `false`. */
  onlyCache?: boolean
  /** Only property names matching this expression may be mangled. */
  regex?: RegExp | string
  /** Property names that must not be mangled. */
  reserved?: readonly string[]
  /** Override the default string-generator mode for property names. */
  stringGeneratorMode?: StringGeneratorModeOption
  /** Mangle accesses rooted at undeclared identifiers. Default `false`. */
  undeclared?: boolean
}

/** Options for the `Function`-constructor packing transform. */
export interface PackOptions {
  /**
   * Skip the strict-mode directive so the packed body runs sloppy even when the
   * source is strict. This deliberately changes behavior. Default `false`.
   */
  escapeStrict?: boolean
  /** Override the default string-generator mode for the names pack creates. */
  stringGeneratorMode?: StringGeneratorModeOption
}

type SimpleTransform = Exclude<
  TransformName,
  'mangleProperties' | 'pack' | 'renameIdentifiers' | 'specialsToStrings'
>

type TransformsMap = Partial<Record<SimpleTransform, boolean>> & {
  mangleProperties?: boolean | ManglePropertiesOptions
  pack?: boolean | PackOptions
  renameIdentifiers?: TransformEntry
  specialsToStrings?: TransformEntry
}

export interface ObfuscatorOptions {
  /** Print Babel's minified output instead of its standard formatted output. */
  minify?: boolean
  /** Logs each pipeline step and its elapsed milliseconds to stderr. */
  verbose?: boolean
  /**
   * Per-transform toggles and string-generator overrides. Omitted transforms
   * are disabled. Preparation passes always run and are not configurable.
   */
  transforms?: TransformsMap
  /**
   * Default mode for generated identifiers, labels, and string contents. An
   * array mixes modes uniformly. Individual transforms may override it through
   * `transforms.<name>.stringGeneratorMode`. Default `'mangled'`.
   */
  stringGeneratorMode?: StringGeneratorModeOption
  /** Seed for any nondeterministic transform. Same seed, same output. Default `0`. */
  seed?: number
}

// Resolved per-call defaults handed to every transform.
export interface TransformContext {
  mangleProperties?: ManglePropertiesOptions
  pack?: PackOptions
  seed: number
  stringGeneratorMode: StringGeneratorModeOption
}
