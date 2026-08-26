import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const docsDirectory = fileURLToPath(new URL('..', import.meta.url))
const webfuscatorDirectory = join(repositoryRoot, 'packages', 'webfuscator')
const transformsDirectory = join(webfuscatorDirectory, 'src', 'transforms')
const outputDirectory = join(docsDirectory, 'reference', 'transforms')
const checkOnly = process.argv.includes('--check')

const titles = {
  argumentsToParameters: 'Arguments to parameters',
  arrowToFunction: 'Arrow to function',
  collapseSingleUseTemps: 'Collapse single-use temporaries',
  concealStrings: 'Conceal strings',
  constLetToVar: 'Const and let to var',
  constToLet: 'Const to let',
  doWhileToWhile: 'Do-while to while',
  dropConsole: 'Drop console calls',
  dropDebugger: 'Drop debugger statements',
  expandBinaryAssignment: 'Expand binary assignments',
  expandLogicalAssignment: 'Expand logical assignments',
  extractObjectProperties: 'Extract object properties',
  foldBuiltinMethods: 'Fold built-in methods',
  foldConstants: 'Fold constants',
  forToWhile: 'For to while',
  functionDeclarationToExpression: 'Function declarations to expressions',
  hoistVariables: 'Hoist variables',
  inlineFunctions: 'Inline functions',
  logicalToTernary: 'Logical expressions to ternaries',
  mangleProperties: 'Mangle properties',
  nullishCoalescingToTernary: 'Nullish coalescing to ternaries',
  numbersToStrings: 'Numbers to strings',
  objectMethodToProperty: 'Object methods to properties',
  optionalChainingToTernary: 'Optional chaining to ternaries',
  pack: 'Pack into a Function constructor',
  packDeclarationsIntoParameters: 'Pack declarations into parameters',
  packExpressions: 'Pack expressions',
  removeAnonymousFunctionNames: 'Remove anonymous function names',
  removeUnreachableCode: 'Remove unreachable code',
  removeUnusedCode: 'Remove unused code',
  renameIdentifiers: 'Rename identifiers',
  reorderFunctionDeclarations: 'Reorder function declarations',
  specialsToStrings: 'Special values to strings',
  switchToIf: 'Switch to if',
  ternaryToIf: 'Ternaries to if statements',
  updateToAssignment: 'Updates to assignments',
  yodifyConditions: 'Yodify conditions',
}

const configurableStringModeTransforms = new Set(['renameIdentifiers', 'specialsToStrings'])

function configuredTransformNames() {
  const optionsSource = readFileSync(join(webfuscatorDirectory, 'src', 'options.ts'), 'utf8')
  const declaration = optionsSource.match(
    /export type TransformName =(?<members>[\s\S]*?)\n\n\/\/ An options object runs/u,
  )
  if (!declaration?.groups) {
    throw new Error('Could not read TransformName from src/options.ts')
  }
  return [...declaration.groups.members.matchAll(/'(?<name>[A-Za-z][A-Za-z0-9]*)'/gu)].map(
    (match) => match.groups.name,
  )
}

function readTransform(fileName) {
  const source = readFileSync(join(transformsDirectory, fileName), 'utf8')
  const exportedFunction = source.match(/export function (?<name>[A-Za-z][A-Za-z0-9]*)\(/u)
  if (!exportedFunction?.groups) {
    throw new Error(`${fileName} does not export a transform function`)
  }

  const transformName = exportedFunction.groups.name
  const documentation = source.match(
    new RegExp(`/\\*\\*(?<body>[\\s\\S]*?)\\*/\\s*export function ${transformName}\\(`, 'u'),
  )
  if (!documentation?.groups) {
    throw new Error(`${fileName} is missing its transform documentation`)
  }

  const lines = documentation.groups.body
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\* ?/u, ''))
  const exampleMarker = lines.findIndex((line) => line.trim() === '@example')
  const beforeMarker = lines.findIndex((line) => /^\/\/ .*before$/u.test(line.trim()))
  const afterMarker = lines.findIndex((line) => /^\/\/ .*after$/u.test(line.trim()))
  if (exampleMarker === -1 || beforeMarker === -1 || afterMarker <= beforeMarker) {
    throw new Error(`${fileName} has an invalid @example block`)
  }

  return {
    behavior: lines.slice(0, exampleMarker).join('\n').trim(),
    before: lines
      .slice(beforeMarker + 1, afterMarker)
      .join('\n')
      .trim(),
    after: lines
      .slice(afterMarker + 1)
      .join('\n')
      .trim(),
    fileName,
    transformName,
  }
}

function configurationNote(transformName) {
  if (transformName === 'concealStrings') {
    return `Pass \`{ cache, cover, scope }\` instead of \`true\`. The string pool is shared by the whole program. Program scope is the default and uses one vault. Function scope keeps encoded entries, decoders, and caches in separate function vaults. Equal strings share one entry within their vault. The default \`regional\` cover fills U+0000-00FF plus every 256-unit page touched anywhere in the program. Use \`used\` for compact output or \`full\` for all 65,536 UTF-16 units. Disable \`cache\` to decode on every evaluation.`
  }

  if (transformName === 'mangleProperties') {
    return `Pass [property-mangling options](/reference/property-mangling-options) instead of \`true\` when you need to limit which properties it changes.`
  }

  if (transformName === 'pack') {
    return `Pass \`{ escapeStrict, skipGlobals, stringGeneratorMode }\` instead of \`true\`. Set \`escapeStrict\` to remove strict mode from the generated function. Set \`skipGlobals\` to \`true\`, or to an array of names, to leave those free names unchanged instead of routing them through accessors. Use it only for names that a generated \`Function\` can read directly.`
  }

  if (configurableStringModeTransforms.has(transformName)) {
    return `Pass \`{ stringGeneratorMode }\` instead of \`true\` to override its generated string style.`
  }

  return null
}

function configurationBlock(transformName) {
  const note = configurationNote(transformName)
  const entryTypes = note ? '`true` or an options object' : '`true`'
  return `## Configuration

Run this transform by setting \`transforms.${transformName}\` to ${entryTypes}:

\`\`\`js obfuscate.mjs highlight={3}
const output = obfuscate(source, {
  transforms: {
    ${transformName}: true,
  },
})
\`\`\`${note ? `\n\n${note}` : ''}`
}

// Only transforms with a public warning need a callout.
function behaviorCallout(transformName) {
  if (transformName === 'concealStrings') {
    return `<Warning>
  String concealment is obfuscation, not encryption. The generated decoder and vault contain everything needed to recover the original strings.
</Warning>`
  }

  if (transformName === 'dropConsole') {
    return `<Note>
  This option removes console output. It removes a call only when evaluating its arguments and computed key has no other side effects. Calls through a shadowed or reassigned \`console\` stay unchanged.
</Note>`
  }

  if (transformName === 'dropDebugger') {
    return `<Note>
  Removing every \`debugger\` statement is the point, so this changes behavior.
</Note>`
  }

  if (transformName === 'mangleProperties') {
    return `<Warning>
  Another file, a JSON payload, a template, the DOM, or reflection can still use a renamed property. The transform cannot see those uses. Restrict mangling to names whose reads and writes you control, using \`regex\`, \`reserved\`, annotations, or a reviewed \`cache\`.
</Warning>`
  }

  if (transformName === 'pack') {
    return `<Warning>
  \`pack\` runs the generated string as a \`Function\` body. \`import.meta\` and top-level \`await\` are syntax errors there. A top-level \`arguments\` refers to the generated function. \`pack\` rejects export statements before producing output.
</Warning>`
  }

  return null
}

function optionBadge(transformName) {
  return `<Badge color="blue" icon="sliders-horizontal" stroke>Option: transforms.${transformName}</Badge>`
}

function pageDescription(behavior) {
  const normalized = behavior.replaceAll(/\s+/gu, ' ')
  const colon = normalized.indexOf(':')
  const period = normalized.indexOf('.')
  const firstSentence =
    colon !== -1 && (period === -1 || colon < period)
      ? `${normalized.slice(0, colon)}.`
      : (normalized.match(/^.*?\.(?:\s|$)/u)?.[0] ?? normalized)
  return firstSentence.replaceAll('`', '').trim()
}

function renderPage(transform) {
  const title = titles[transform.transformName]
  if (!title) {
    throw new Error(`Add a documentation title for ${transform.transformName}`)
  }

  const sourceUrl = `https://github.com/esoware/webfuscator/blob/main/packages/webfuscator/src/transforms/${transform.fileName}`
  const testUrl = `https://github.com/esoware/webfuscator/blob/main/packages/webfuscator/tests/transforms/${transform.fileName.replace(/\.ts$/u, '.test.ts')}`
  const callout = behaviorCallout(transform.transformName)
  return `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(pageDescription(transform.behavior))}
keywords: [${JSON.stringify(transform.transformName)}, "JavaScript transform"]
---
{/* Generated by scripts/generate-transforms.mjs. Do not edit directly. */}

${optionBadge(transform.transformName)}

## What it changes

${transform.behavior}

${callout ? `${callout}\n\n` : ''}## Before and after

<CodeGroup>

\`\`\`js title="Before" lines
${transform.before}
\`\`\`

\`\`\`js title="After" lines
${transform.after}
\`\`\`

</CodeGroup>

${configurationBlock(transform.transformName)}

<Columns cols={2}>
  <Card title="View the implementation" icon="code-xml" href="${sourceUrl}" horizontal>
    Open the TypeScript implementation on GitHub.
  </Card>
  <Card title="Read the behavior tests" icon="flask-conical" href="${testUrl}" horizontal>
    Review behavior checks and cases this transform leaves alone.
  </Card>
</Columns>
`
}

const configuredNames = configuredTransformNames().toSorted()
const transforms = readdirSync(transformsDirectory)
  .filter((fileName) => fileName.endsWith('.ts'))
  .toSorted()
  .map((fileName) => readTransform(fileName))
const exportedNames = transforms.map((transform) => transform.transformName).toSorted()

if (configuredNames.join('\n') !== exportedNames.join('\n')) {
  throw new Error(
    `TransformName and packages/webfuscator/src/transforms differ:\nconfigured: ${configuredNames.join(', ')}\nexported: ${exportedNames.join(', ')}`,
  )
}

const expectedFiles = new Set(
  transforms.map((transform) => transform.fileName.replace(/\.ts$/u, '.mdx')),
)
if (existsSync(outputDirectory)) {
  const unexpectedFiles = readdirSync(outputDirectory).filter(
    (fileName) => fileName.endsWith('.mdx') && !expectedFiles.has(fileName),
  )
  if (unexpectedFiles.length > 0) {
    throw new Error(`Unexpected generated transform pages: ${unexpectedFiles.join(', ')}`)
  }
}

const staleFiles = []
for (const transform of transforms) {
  const outputPath = join(outputDirectory, transform.fileName.replace(/\.ts$/u, '.mdx'))
  const output = renderPage(transform)
  if (checkOnly) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
      staleFiles.push(relative(repositoryRoot, outputPath))
    }
  } else {
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, output)
  }
}

if (staleFiles.length > 0) {
  throw new Error(`Generated transform documentation is stale:\n${staleFiles.join('\n')}`)
}

process.stdout.write(
  checkOnly
    ? `Verified ${transforms.length} generated transform pages.\n`
    : `Generated ${transforms.length} transform pages.\n`,
)
