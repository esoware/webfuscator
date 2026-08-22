import type { StringGeneratorModeOption } from 'webfuscator'

import { STRING_GENERATOR_MODES } from './schema'

/** `mixed` stands in for an array of modes, which no single select can show. */
export function displayMode(value: StringGeneratorModeOption | undefined): string {
  if (value === undefined) {
    return 'inherit'
  }
  return typeof value === 'string' ? value : 'mixed'
}

export function modeChoices(
  current: StringGeneratorModeOption | undefined,
  includeInherit: boolean,
): { value: string; label: string }[] {
  const choices = includeInherit ? [{ value: 'inherit', label: 'Inherit' }] : []
  for (const mode of STRING_GENERATOR_MODES) {
    choices.push({ value: mode, label: mode })
  }
  if (Array.isArray(current)) {
    choices.push({ value: 'mixed', label: 'Mixed' })
  }
  return choices
}
