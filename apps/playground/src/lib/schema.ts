import type {
  ObfuscatorOptions,
  StringGeneratorMode,
  StringGeneratorModeOption,
  TransformName,
} from 'webfuscator'

export const STRING_GENERATOR_MODES = [
  'mangled',
  'hexadecimal',
  'randomized',
  'zeroWidth',
  'number',
] as const satisfies readonly StringGeneratorMode[]

export function isStringGeneratorMode(value: string): value is StringGeneratorMode {
  return (STRING_GENERATOR_MODES as readonly string[]).includes(value)
}

/** The serializer omits these, since the library assumes them anyway. */
export function isDefaultModeOption(value: StringGeneratorModeOption): boolean {
  const modes = Array.isArray(value) ? value : [value]
  return modes.length > 0 && modes.every((mode) => mode === 'mangled')
}

/** How much of an entry the options panel renders below its toggle. */
type TransformKind = 'boolean' | 'mode' | 'mangle' | 'pack'

export interface TransformSpec {
  name: TransformName
  kind: TransformKind
  description: string
}

export interface TransformGroup {
  title: string
  transforms: readonly TransformSpec[]
}

/** Grouping and order mirror the Reference section of the docs. */
export const TRANSFORM_GROUPS = [
  {
    title: 'Removal',
    transforms: [
      {
        name: 'dropConsole',
        kind: 'boolean',
        description: 'Removes console.* calls when console is not shadowed locally.',
      },
      { name: 'dropDebugger', kind: 'boolean', description: 'Removes every debugger statement.' },
      {
        name: 'removeUnreachableCode',
        kind: 'boolean',
        description: 'Removes statements after unconditional control flow.',
      },
      {
        name: 'removeUnusedCode',
        kind: 'boolean',
        description: 'Removes unused declarations and effect-free statements.',
      },
      {
        name: 'removeAnonymousFunctionNames',
        kind: 'boolean',
        description: 'Drops function expression names nothing can observe.',
      },
    ],
  },
  {
    title: 'Simplification and inlining',
    transforms: [
      {
        name: 'argumentsToParameters',
        kind: 'boolean',
        description: 'Replaces arguments[i] reads with their mapped parameter.',
      },
      {
        name: 'foldConstants',
        kind: 'boolean',
        description: 'Folds pure constant expressions to literals.',
      },
      {
        name: 'foldBuiltinMethods',
        kind: 'boolean',
        description: 'Replaces eligible built-in calls with host-computed constants.',
      },
      {
        name: 'extractObjectProperties',
        kind: 'boolean',
        description: 'Splits constant object wrappers into one binding per entry.',
      },
      {
        name: 'inlineFunctions',
        kind: 'boolean',
        description: 'Inlines eligible calls with the callee body.',
      },
      {
        name: 'collapseSingleUseTemps',
        kind: 'boolean',
        description: 'Substitutes single-use temporaries at their use site.',
      },
    ],
  },
  {
    title: 'Declarations and functions',
    transforms: [
      {
        name: 'constToLet',
        kind: 'boolean',
        description: 'Changes const to let where no read can observe the difference.',
      },
      {
        name: 'constLetToVar',
        kind: 'boolean',
        description: 'Lifts safe lexical declarations to function-scoped var.',
      },
      {
        name: 'objectMethodToProperty',
        kind: 'boolean',
        description: 'Rewrites object methods as function-valued properties.',
      },
      {
        name: 'arrowToFunction',
        kind: 'boolean',
        description: 'Lowers arrow functions to function expressions.',
      },
      {
        name: 'functionDeclarationToExpression',
        kind: 'boolean',
        description: 'Rewrites safe function declarations as var initializers.',
      },
      {
        name: 'packDeclarationsIntoParameters',
        kind: 'boolean',
        description: 'Moves literal var declarations into trailing default parameters.',
      },
    ],
  },
  {
    title: 'Control flow',
    transforms: [
      {
        name: 'switchToIf',
        kind: 'boolean',
        description: 'Lowers switch statements to if chains.',
      },
      {
        name: 'forToWhile',
        kind: 'boolean',
        description: 'Rewrites classic and iterator for loops as while loops.',
      },
      {
        name: 'doWhileToWhile',
        kind: 'boolean',
        description: 'Rewrites do loops as while (true) with an exit test.',
      },
      {
        name: 'optionalChainingToTernary',
        kind: 'boolean',
        description: 'Rewrites optional chains as nested ternaries.',
      },
      {
        name: 'nullishCoalescingToTernary',
        kind: 'boolean',
        description: 'Rewrites a ?? b as a guarded assignment or ternary.',
      },
      {
        name: 'logicalToTernary',
        kind: 'boolean',
        description: 'Rewrites logical expressions as guarded assignments or ternaries.',
      },
      {
        name: 'ternaryToIf',
        kind: 'boolean',
        description: 'Lowers conditional expressions to if statements.',
      },
    ],
  },
  {
    title: 'Expression transforms',
    transforms: [
      {
        name: 'updateToAssignment',
        kind: 'boolean',
        description: 'Rewrites ++/-- updates as compound assignments.',
      },
      {
        name: 'expandBinaryAssignment',
        kind: 'boolean',
        description: 'Expands compound assignments to LHS = LHS op RHS.',
      },
      {
        name: 'expandLogicalAssignment',
        kind: 'boolean',
        description: 'Expands ||=, &&=, and ??= to expanded assignments.',
      },
      {
        name: 'yodifyConditions',
        kind: 'boolean',
        description: 'Swaps comparison operands so literals sit on the left.',
      },
    ],
  },
  {
    title: 'Names and literals',
    transforms: [
      {
        name: 'specialsToStrings',
        kind: 'mode',
        description: 'Rewrites true, false, undefined, NaN, and Infinity through strings.',
      },
      {
        name: 'numbersToStrings',
        kind: 'mode',
        description: 'Rewrites numeric literals as strings coerced with unary plus.',
      },
      {
        name: 'mangleProperties',
        kind: 'mangle',
        description:
          'Renames statically known properties through one mapping. Boundary-dependent: outside code using the same names breaks.',
      },
      {
        name: 'renameIdentifiers',
        kind: 'mode',
        description: 'Renames bindings and labels with generated names.',
      },
    ],
  },
  {
    title: 'Packing',
    transforms: [
      {
        name: 'pack',
        kind: 'pack',
        description: 'Serializes the program into a single Function constructor call.',
      },
    ],
  },
] as const satisfies readonly TransformGroup[]

type ListedTransform = (typeof TRANSFORM_GROUPS)[number]['transforms'][number]['name']

export const ALL_TRANSFORMS: readonly TransformSpec[] = TRANSFORM_GROUPS.flatMap(
  (group): readonly TransformSpec[] => group.transforms,
)

/**
 * Doubles as the exhaustiveness check on the table above. The serializer walks
 * that table, so a `TransformName` missing from it drops out of every config the
 * playground writes. The assignment below stops compiling when one is missing.
 */
export const TRANSFORM_BY_NAME: Record<TransformName, TransformSpec> = Object.fromEntries(
  ALL_TRANSFORMS.map((spec) => [spec.name, spec]),
) as Record<ListedTransform, TransformSpec>

type MangleFlagKey = 'builtins' | 'undeclared' | 'onlyAnnotated' | 'onlyCache'

export const MANGLE_FLAGS = [
  { key: 'builtins', description: 'Also mangle JavaScript and DOM builtin names' },
  { key: 'undeclared', description: 'Mangle accesses rooted at undeclared identifiers' },
  { key: 'onlyAnnotated', description: 'Only names marked with /*@__MANGLE_PROP__*/' },
  { key: 'onlyCache', description: 'Only names already present in the cache' },
] as const satisfies readonly { key: MangleFlagKey; description: string }[]

export const KEEP_QUOTED_CHOICES = [
  { value: 'false', label: 'Off' },
  { value: 'strict', label: 'Strict' },
  { value: 'true', label: 'On' },
] as const

/** The starter preset. Every pass here is behavior-preserving. */
export const DEFAULT_OPTIONS: ObfuscatorOptions = {
  transforms: {
    foldConstants: true,
    foldBuiltinMethods: true,
    extractObjectProperties: true,
    inlineFunctions: true,
    removeUnreachableCode: true,
    removeUnusedCode: true,
    collapseSingleUseTemps: true,
    renameIdentifiers: true,
  },
}
