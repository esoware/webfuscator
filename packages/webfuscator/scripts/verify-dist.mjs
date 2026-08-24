import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import { parse } from '@babel/parser'

// `tsc` copies every relative specifier into its output verbatim, so a build
// that loses the `tsc-alias` step still imports cleanly from a bundler and
// throws ERR_MODULE_NOT_FOUND under Node. Nothing else reads `dist`, so without
// this check that build ships.

const distDirectory = path.join(import.meta.dirname, '..', 'dist')

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else {
      yield full
    }
  }
}

function findExtensionlessSpecifiers() {
  const offenders = []
  for (const file of walk(distDirectory)) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) {
      continue
    }
    const text = fs.readFileSync(file, 'utf8')
    for (const specifier of moduleSpecifiers(file, text)) {
      if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
        offenders.push(`${path.relative(distDirectory, file)} imports "${specifier}"`)
      }
    }
  }
  return offenders
}

function moduleSpecifiers(file, text) {
  const ast = parse(text, {
    plugins: file.endsWith('.d.ts') ? ['typescript'] : [],
    sourceType: 'unambiguous',
  })
  const specifiers = []
  visit(ast.program, specifiers)
  return specifiers
}

function visit(value, specifiers) {
  if (Array.isArray(value)) {
    for (const element of value) {
      visit(element, specifiers)
    }
    return
  }
  if (value === null || typeof value !== 'object') {
    return
  }

  if (
    (value.type === 'ImportDeclaration' ||
      value.type === 'ExportAllDeclaration' ||
      value.type === 'ExportNamedDeclaration') &&
    value.source?.type === 'StringLiteral'
  ) {
    specifiers.push(value.source.value)
  } else if (
    (value.type === 'ImportExpression' || value.type === 'TSImportType') &&
    value.source?.type === 'StringLiteral'
  ) {
    specifiers.push(value.source.value)
  }

  for (const child of Object.values(value)) {
    visit(child, specifiers)
  }
}

const offenders = findExtensionlessSpecifiers()
if (offenders.length > 0) {
  throw new Error(
    `dist has ${offenders.length} unresolvable specifier(s):\n  ${offenders.join('\n  ')}`,
  )
}

const entry = pathToFileURL(path.join(distDirectory, 'index.js')).href
const { obfuscate } = await import(entry)

if (typeof obfuscate !== 'function') {
  throw new TypeError(`${entry} does not export obfuscate`)
}

const output = obfuscate('var greeting = "hi"; log(greeting);', {
  transforms: { renameIdentifiers: true },
})

if (!output.includes('log(') || output.includes('greeting')) {
  throw new Error(`dist entry point produced unexpected output:\n${output}`)
}
