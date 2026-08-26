import { obfuscate } from '../src/index'
import type { ObfuscatorOptions, TransformName } from '../src/index'
import { CONFIGURABLE_TRANSFORM_NAMES } from '../src/obfuscator'

// Arbitrary fixtures cannot supply the boundary required by `mangleProperties`
// or preserve every program after `pack` moves it into a `Function` body. Their
// own suites set those transform entries to `true` explicitly.
const BLANKET_UNSAFE = new Set<TransformName>(['mangleProperties', 'pack'])

// Derive the map from the phase tables so new transforms enter these suites when
// they enter the pipeline.
const ALL_TRANSFORMS = Object.fromEntries(
  CONFIGURABLE_TRANSFORM_NAMES.map((name) => [name, !BLANKET_UNSAFE.has(name)]),
) as NonNullable<ObfuscatorOptions['transforms']>

/** Sets every integration-safe transform to `true`, then applies `options`. */
export function obfuscateAll(code: string, options: ObfuscatorOptions = {}): string {
  return obfuscate(code, {
    ...options,
    transforms: { ...ALL_TRANSFORMS, ...options.transforms },
  })
}
