import type {
  ManglePropertiesOptions,
  ObfuscatorOptions,
  PackOptions,
  StringGeneratorModeOption,
  TransformName,
} from 'webfuscator'

import {
  ALL_TRANSFORMS,
  STRING_GENERATOR_MODES,
  TRANSFORM_BY_NAME,
  isDefaultModeOption,
  isStringGeneratorMode,
} from './schema'

type TransformsMap = NonNullable<ObfuscatorOptions['transforms']>

/** The transforms whose entry may be an override object instead of a boolean. */
type ModeOverrideName = Extract<TransformName, 'renameIdentifiers' | 'specialsToStrings'>

interface ConfigParseSuccess {
  status: 'ok'
  options: ObfuscatorOptions
  warnings: readonly string[]
}

interface ConfigParseFailure {
  status: 'error'
  message: string
}

export type ConfigParseResult = ConfigParseSuccess | ConfigParseFailure

const TOP_LEVEL_KEYS = new Set(['minify', 'verbose', 'seed', 'stringGeneratorMode', 'transforms'])

/**
 * Values equal to the library defaults are left unset, so an untouched config
 * prints `{}`.
 */
export function serializeOptions(options: ObfuscatorOptions): string {
  const root: Record<string, unknown> = {}

  if (options.minify === true) {
    root['minify'] = true
  }
  if (options.verbose === true) {
    root['verbose'] = true
  }
  if (options.seed !== undefined && options.seed !== 0) {
    root['seed'] = options.seed
  }
  if (
    options.stringGeneratorMode !== undefined &&
    !isDefaultModeOption(options.stringGeneratorMode)
  ) {
    root['stringGeneratorMode'] =
      typeof options.stringGeneratorMode === 'string'
        ? options.stringGeneratorMode
        : [...options.stringGeneratorMode]
  }

  const transforms = serializeTransforms(options.transforms)
  if (transforms !== undefined) {
    root['transforms'] = transforms
  }

  return stringifyValue(root, 0)
}

function serializeTransforms(
  transforms: TransformsMap | undefined,
): Record<string, unknown> | undefined {
  if (transforms === undefined) {
    return undefined
  }

  const out: Record<string, unknown> = {}
  for (const spec of ALL_TRANSFORMS) {
    const entry = transforms[spec.name]
    if (entry === undefined || entry === false) {
      continue
    }
    switch (spec.kind) {
      case 'boolean':
        out[spec.name] = true
        break
      case 'mode':
        out[spec.name] =
          typeof entry === 'object' ? serializeModeEntry(entry.stringGeneratorMode) : true
        break
      case 'mangle':
        out[spec.name] = typeof entry === 'object' ? serializeMangle(entry) : true
        break
      case 'pack':
        out[spec.name] = typeof entry === 'object' ? serializePack(entry) : true
        break
    }
  }

  return Object.keys(out).length > 0 ? out : undefined
}

function serializeModeEntry(mode: StringGeneratorModeOption | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (mode !== undefined && !isDefaultModeOption(mode)) {
    out['stringGeneratorMode'] = typeof mode === 'string' ? mode : [...mode]
  }
  return out
}

function serializeMangle(mangle: ManglePropertiesOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (mangle.builtins === true) {
    out['builtins'] = true
  }
  if (mangle.undeclared === true) {
    out['undeclared'] = true
  }
  if (mangle.onlyAnnotated === true) {
    out['onlyAnnotated'] = true
  }
  if (mangle.onlyCache === true) {
    out['onlyCache'] = true
  }
  if (mangle.debug !== undefined && mangle.debug !== false) {
    out['debug'] = mangle.debug
  }
  if (mangle.keepQuoted !== undefined && mangle.keepQuoted !== false) {
    out['keepQuoted'] = mangle.keepQuoted
  }
  if (mangle.regex !== undefined) {
    out['regex'] = mangle.regex instanceof RegExp ? mangle.regex.source : mangle.regex
  }
  if (mangle.reserved !== undefined && mangle.reserved.length > 0) {
    out['reserved'] = [...mangle.reserved]
  }

  const mode = serializeModeEntry(mangle.stringGeneratorMode)
  if (Object.keys(mode).length > 0) {
    out['stringGeneratorMode'] = mode['stringGeneratorMode']
  }

  return out
}

function serializePack(pack: PackOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (pack.escapeStrict === true) {
    out['escapeStrict'] = true
  }

  const mode = serializeModeEntry(pack.stringGeneratorMode)
  if (Object.keys(mode).length > 0) {
    out['stringGeneratorMode'] = mode['stringGeneratorMode']
  }

  return out
}

function pad(level: number): string {
  return '  '.repeat(level)
}

function propertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? key : JSON.stringify(key)
}

function stringifyValue(value: unknown, level: number): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]'
    }
    const items = value
      .map((item) => `${pad(level + 1)}${stringifyValue(item, level + 1)},`)
      .join('\n')
    return `[\n${items}\n${pad(level)}]`
  }

  // Only plain objects reach this point; the branches above take everything else.
  const record = value as Record<string, unknown>
  const entries = Object.entries(record).filter(([, item]) => item !== undefined)
  if (entries.length === 0) {
    return '{}'
  }
  const lines = entries
    .map(
      ([key, item]) => `${pad(level + 1)}${propertyKey(key)}: ${stringifyValue(item, level + 1)},`,
    )
    .join('\n')
  return `{\n${lines}\n${pad(level)}}`
}

/**
 * Evaluates the editor contents as a JavaScript object literal. An unknown or
 * malformed field comes back as a warning rather than an error, so one typo
 * does not discard the rest of the config.
 */
export function parseConfig(text: string): ConfigParseResult {
  let raw: unknown
  try {
    // Evaluating the user's JavaScript is the point of the config tab.
    // oxlint-disable-next-line no-new-func
    raw = new Function(`return (\n${text}\n)`)()
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  return validateOptions(raw)
}

export function validateOptions(raw: unknown): ConfigParseResult {
  const warnings: string[] = []

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { status: 'error', message: 'The config must evaluate to a plain object.' }
  }

  const input = raw as Record<string, unknown>
  const options: ObfuscatorOptions = {}

  const minify = expectBoolean(input, 'minify', warnings)
  if (minify !== undefined) {
    options.minify = minify
  }

  const verbose = expectBoolean(input, 'verbose', warnings)
  if (verbose !== undefined) {
    options.verbose = verbose
  }

  const seed = expectSeed(input, warnings)
  if (seed !== undefined) {
    options.seed = seed
  }

  const mode = expectModeOption(input['stringGeneratorMode'], 'stringGeneratorMode', warnings)
  if (mode !== undefined) {
    options.stringGeneratorMode = mode
  }

  const transforms = expectTransforms(input['transforms'], warnings)
  if (transforms !== undefined) {
    options.transforms = transforms
  }

  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      warnings.push(`Ignoring unknown option "${key}".`)
    }
  }

  return { status: 'ok', options, warnings }
}

function expectBoolean(
  container: Record<string, unknown>,
  key: string,
  warnings: string[],
): boolean | undefined {
  const value = container[key]
  if (value === undefined || typeof value === 'boolean') {
    return value
  }
  warnings.push(`Ignoring "${key}": expected true or false.`)
  return undefined
}

function expectSeed(container: Record<string, unknown>, warnings: string[]): number | undefined {
  const value = container['seed']
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  warnings.push('Ignoring "seed": expected a non-negative integer.')
  return undefined
}

function expectModeOption(
  value: unknown,
  key: string,
  warnings: string[],
): StringGeneratorModeOption | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'string' && isStringGeneratorMode(value)) {
    return value
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && isStringGeneratorMode(item))
  ) {
    return [...value] as StringGeneratorModeOption
  }
  warnings.push(
    `Ignoring "${key}": expected a generator mode (${STRING_GENERATOR_MODES.join(', ')}) or an array of them.`,
  )
  return undefined
}

function expectTransforms(value: unknown, warnings: string[]): TransformsMap | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    warnings.push('Ignoring "transforms": expected an object.')
    return undefined
  }

  const input = value as Record<string, unknown>
  const transforms: Record<string, unknown> = {}

  for (const spec of ALL_TRANSFORMS) {
    const entry = input[spec.name]
    if (entry === undefined || entry === false) {
      continue
    }
    if (spec.kind === 'boolean') {
      if (entry !== true) {
        warnings.push(`Ignoring "${spec.name}": expected true or false.`)
        continue
      }
      // TypeScript cannot correlate a spec's `kind` with its `name`, though the
      // branch above has already proven which subset this name belongs to.
      transforms[
        spec.name as Exclude<TransformName, ModeOverrideName | 'mangleProperties' | 'pack'>
      ] = true
      continue
    }
    // A malformed entry leaves the transform off. Turning it on with defaults
    // would run a pass nobody asked for, and `mangleProperties` renames
    // properties that code outside the input reads.
    if (spec.kind === 'mode') {
      const mode = expectModeEntry(spec.name as ModeOverrideName, entry, warnings)
      if (mode !== undefined) {
        transforms[spec.name as ModeOverrideName] = mode
      }
      continue
    }
    if (spec.kind === 'mangle') {
      const mangle = entry === true ? true : expectMangle(entry, warnings)
      if (mangle !== undefined) {
        transforms['mangleProperties'] = mangle
      }
      continue
    }
    const pack = entry === true ? true : expectPack(entry, warnings)
    if (pack !== undefined) {
      transforms['pack'] = pack
    }
  }

  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(TRANSFORM_BY_NAME, key)) {
      warnings.push(`Ignoring unknown transform "${key}".`)
    }
  }

  // The same missing correlation, on entries the loop has already shape-checked.
  return Object.keys(transforms).length > 0 ? (transforms as TransformsMap) : undefined
}

function expectModeEntry(
  name: ModeOverrideName,
  entry: unknown,
  warnings: string[],
): boolean | { stringGeneratorMode?: StringGeneratorModeOption } | undefined {
  if (entry === true) {
    return true
  }
  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
    const mode = expectModeOption(
      (entry as Record<string, unknown>)['stringGeneratorMode'],
      `transforms.${name}.stringGeneratorMode`,
      warnings,
    )
    if (mode === undefined) {
      return true
    }
    return { stringGeneratorMode: mode }
  }
  warnings.push(`Ignoring "${name}": expected true or a string-generator override object.`)
  return undefined
}

function expectMangle(entry: unknown, warnings: string[]): ManglePropertiesOptions | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    warnings.push('Ignoring "mangleProperties": expected true or an options object.')
    return undefined
  }

  const input = entry as Record<string, unknown>
  const mangle: ManglePropertiesOptions = {}

  assignIfDefined(mangle, 'builtins', expectBoolean(input, 'builtins', warnings))
  assignIfDefined(mangle, 'undeclared', expectBoolean(input, 'undeclared', warnings))
  assignIfDefined(mangle, 'onlyAnnotated', expectBoolean(input, 'onlyAnnotated', warnings))
  assignIfDefined(mangle, 'onlyCache', expectBoolean(input, 'onlyCache', warnings))

  const debug = input['debug']
  if (typeof debug === 'boolean') {
    assignIfDefined(mangle, 'debug', debug)
  } else if (typeof debug === 'string') {
    assignIfDefined(mangle, 'debug', debug)
  } else if (debug !== undefined) {
    warnings.push('Ignoring "mangleProperties.debug": expected a boolean or string.')
  }

  const keepQuoted = input['keepQuoted']
  if (keepQuoted === true || keepQuoted === false || keepQuoted === 'strict') {
    assignIfDefined(mangle, 'keepQuoted', keepQuoted)
  } else if (keepQuoted !== undefined) {
    warnings.push('Ignoring "mangleProperties.keepQuoted": expected true, false, or "strict".')
  }

  const regex = input['regex']
  if (typeof regex === 'string') {
    assignIfDefined(mangle, 'regex', regex)
  } else if (regex instanceof RegExp) {
    // Stored as a source string so the option survives `JSON.stringify` on the
    // way into localStorage. The library compiles a bare source without flags.
    if (regex.flags.length > 0) {
      warnings.push(`Dropping the "${regex.flags}" flags from "mangleProperties.regex".`)
    }
    assignIfDefined(mangle, 'regex', regex.source)
  } else if (regex !== undefined) {
    warnings.push('Ignoring "mangleProperties.regex": expected a pattern string or a RegExp.')
  }

  const reserved = input['reserved']
  if (reserved === undefined) {
    // Leave unset.
  } else if (Array.isArray(reserved) && reserved.every((name) => typeof name === 'string')) {
    assignIfDefined(mangle, 'reserved', [...reserved])
  } else {
    warnings.push('Ignoring "mangleProperties.reserved": expected an array of strings.')
  }

  const mode = expectModeOption(
    input['stringGeneratorMode'],
    'mangleProperties.stringGeneratorMode',
    warnings,
  )
  assignIfDefined(mangle, 'stringGeneratorMode', mode)

  if ('cache' in input) {
    warnings.push('"mangleProperties.cache" cannot round-trip through the playground.')
  }
  if ('nameGenerator' in input) {
    warnings.push('"mangleProperties.nameGenerator" cannot round-trip through the playground.')
  }

  return mangle
}

function expectPack(entry: unknown, warnings: string[]): PackOptions | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    warnings.push('Ignoring "pack": expected true or an options object.')
    return undefined
  }

  const input = entry as Record<string, unknown>
  const pack: PackOptions = {}

  const escapeStrict = expectBoolean(input, 'escapeStrict', warnings)
  if (escapeStrict !== undefined) {
    assignIfDefined(pack, 'escapeStrict', escapeStrict)
  }

  const mode = expectModeOption(input['stringGeneratorMode'], 'pack.stringGeneratorMode', warnings)
  assignIfDefined(pack, 'stringGeneratorMode', mode)

  return pack
}

// Under exactOptionalPropertyTypes, assigning `undefined` to an optional key is
// an error, so this guard is what lets every call site above type-check.
function assignIfDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value
  }
}
