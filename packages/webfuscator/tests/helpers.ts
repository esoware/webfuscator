import * as fs from 'node:fs'
import * as path from 'node:path'

import generate from '@babel/generator'
import { parse } from '@babel/parser'
import type { File } from '@babel/types'

/** Parses, transforms, and prints `code`. */
export function run(code: string, fn: (ast: File) => void): string {
  const ast = parse(code, { sourceType: 'unambiguous' })
  fn(ast)
  return generate(ast, { comments: false }).code
}

/**
 * Records calls to `log` and the class of any thrown value while evaluating
 * `code`. Equal traces prove observable behavior. Output shape alone does not.
 */
export function trace(code: string): { logs: unknown[]; threw: string | null } {
  const logs: unknown[] = []
  const log = (...args: unknown[]): void => {
    logs.push(args.length === 1 ? args[0] : args)
  }
  try {
    // oxlint-disable-next-line no-new-func
    new Function('log', code)(log)
    return { logs, threw: null }
  } catch (error) {
    return { logs, threw: (error as Error).constructor.name }
  }
}

export interface FixtureCase {
  name: string
  input: string
}

const OUTPUT_DIR = path.join(import.meta.dirname, 'fixtures', 'output')

/**
 * Returns `cases` and writes each isolated transform result to
 * `tests/fixtures/output/<fileName>.js`.
 */
export function defineCases<T extends Record<string, FixtureCase>>(
  fileName: string,
  transform: (ast: File) => void,
  cases: T,
): T {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const blocks: string[] = []
  for (const c of Object.values(cases)) {
    const before = generate(parse(c.input, { sourceType: 'unambiguous' }), {
      comments: false,
    }).code
    const after = run(c.input, transform)
    blocks.push(`/// ${c.name}\n// ◀️ before\n${before}\n\n// ▶️ after\n${after}\n`)
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, `${fileName}.js`), `${blocks.join('\n\n')}\n`)
  return cases
}
