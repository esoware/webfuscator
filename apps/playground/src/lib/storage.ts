import type { ObfuscatorOptions } from 'webfuscator'

import { validateOptions } from './config'
import { SAMPLE_SOURCE } from './sample'
import { DEFAULT_OPTIONS } from './schema'

// Bumped from v1, whose stored sample described a playground that re-ran on
// every keystroke.
const STORAGE_KEY = 'webfuscator.playground.v2'

export interface Workspace {
  source: string
  options: ObfuscatorOptions
  runOnChange: boolean
}

export function loadWorkspace(): Partial<Workspace> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) {
      return {}
    }
    const raw = JSON.parse(stored) as Record<string, unknown>
    const workspace: Partial<Workspace> = {}
    if (typeof raw['source'] === 'string') {
      workspace.source = raw['source']
    }
    if (typeof raw['runOnChange'] === 'boolean') {
      workspace.runOnChange = raw['runOnChange']
    }
    const result = validateOptions(raw['options'])
    if (result.status === 'ok') {
      workspace.options = result.options
    }
    return workspace
  } catch {
    return {}
  }
}

export function saveWorkspace(workspace: Workspace): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
  } catch {
    // Persistence is best effort. Private browsing and a full quota both throw here.
  }
}

export function defaultWorkspace(): Workspace {
  return { source: SAMPLE_SOURCE, options: DEFAULT_OPTIONS, runOnChange: false }
}
