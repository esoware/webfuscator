import type { ObfuscatorOptions, StringGeneratorModeOption, TransformName } from 'webfuscator'

type TransformsMap = NonNullable<ObfuscatorOptions['transforms']>

// The explicit `| undefined` re-permits what exactOptionalPropertyTypes forbids,
// so a patch can pass `undefined` to clear a key.
export type PatchOf<T> = { [K in keyof T]?: T[K] | undefined }

/** The one field a mode, mangle, and pack entry all have in common. */
export interface ModeOverride {
  stringGeneratorMode?: StringGeneratorModeOption
}

// A computed key cannot target a union of literal transform names, so the map is
// edited through a string-keyed view.
export function editTransformEntry(
  options: ObfuscatorOptions,
  name: TransformName,
  entry: unknown,
): ObfuscatorOptions {
  const transforms: Record<string, unknown> = { ...options.transforms }
  if (entry === undefined) {
    delete transforms[name]
  } else {
    transforms[name] = entry
  }
  return { ...options, transforms: transforms as TransformsMap }
}

/**
 * Writes one field of a transform entry and leaves its siblings alone. An entry
 * left holding no fields collapses to a bare `true`, so the config prints
 * `pack: true` rather than `pack: {}`.
 */
export function patchTransformEntry<T extends object>(
  options: ObfuscatorOptions,
  name: TransformName,
  entry: unknown,
  patch: PatchOf<T>,
): ObfuscatorOptions {
  const merged = mergePatch(entryObject<T>(entry), patch)
  return editTransformEntry(options, name, Object.keys(merged).length === 0 ? true : merged)
}

export function mergePatch<T extends object>(current: T, patch: PatchOf<T>): T {
  // A generic spread carries no index signature, so deleting a key needs this view.
  const next = { ...current } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  return next as T
}

export function entryObject<T extends object>(entry: unknown): T {
  return typeof entry === 'object' && entry !== null ? (entry as T) : ({} as T)
}

export function entryMode(entry: unknown): StringGeneratorModeOption | undefined {
  if (typeof entry === 'object' && entry !== null && 'stringGeneratorMode' in entry) {
    return (entry as ModeOverride).stringGeneratorMode
  }
  return undefined
}
