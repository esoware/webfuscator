import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const webfuscatorDirectory = join(repositoryRoot, 'packages', 'webfuscator')
const transformsDirectory = join(webfuscatorDirectory, 'src', 'transforms')
const outputDirectory = join(repositoryRoot, 'docs', 'reference', 'transforms')
const checkOnly = process.argv.includes('--check')

const titles = {
  argumentsToParameters: 'Arguments to parameters',
  arrowToFunction: 'Arrow to function',
  collapseSingleUseTemps: 'Collapse single-use temporaries',
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
  inlineFunctions: 'Inline functions',
  logicalToTernary: 'Logical expressions to ternaries',
  mangleProperties: 'Mangle properties',
  nullishCoalescingToTernary: 'Nullish coalescing to ternaries',
  numbersToStrings: 'Numbers to strings',
  objectMethodToProperty: 'Object methods to properties',
  optionalChainingToTernary: 'Optional chaining to ternaries',
  pack: 'Pack into a Function constructor',
  packDeclarationsIntoParameters: 'Pack declarations into parameters',
  removeAnonymousFunctionNames: 'Remove anonymous function names',
  removeUnreachableCode: 'Remove unreachable code',
  removeUnusedCode: 'Remove unused code',
  renameIdentifiers: 'Rename identifiers',
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
    /export type TransformName =(?<members>[\s\S]*?)\n\n\/\/ An override enables/u,
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
    behavior: publicBehavior(transformName, lines.slice(0, exampleMarker).join('\n').trim()),
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

function publicBehavior(transformName, behavior) {
  switch (transformName) {
    case 'logicalToTernary':
      return behavior.replace(
        'A\nside-effectful left side is cached in the ternary test for later hoisting.',
        'A side-effectful left side is cached so it is evaluated once.',
      )
    case 'mangleProperties':
      return behavior
        .replace('that this pipeline must leave unchanged.', 'that must remain unchanged.')
        .replace(/\n\nThis pass runs before shape preparation,[\s\S]*?source keys\./u, '')
    case 'numbersToStrings':
      return behavior.replace(
        '\n\nPreparation has already converted numeric object keys to strings.',
        '',
      )
    case 'renameIdentifiers':
      return behavior.replace('a fresh `StringGenerator`', 'the configured string generator')
    case 'specialsToStrings':
      return behavior.replace(
        'through strings for later string mangling:',
        'through string expressions:',
      )
    case 'updateToAssignment':
      return behavior.replace(
        'as compound assignments for later expansion.',
        'as compound assignments.',
      )
    default:
      return behavior
  }
}

function configurationNote(transformName) {
  if (transformName === 'mangleProperties') {
    return `Pass [property-mangling options](/reference/property-mangling-options) instead of \`true\` when you need to limit which properties it changes.`
  }

  if (transformName === 'pack') {
    return `Pass \`{ escapeStrict, stringGeneratorMode }\` instead of \`true\`. Set \`escapeStrict\` to run the packed body in sloppy mode even when the source is strict, which deliberately changes behavior.`
  }

  if (configurableStringModeTransforms.has(transformName)) {
    return `Pass \`{ stringGeneratorMode }\` instead of \`true\` to override its generated string style.`
  }

  return null
}

function configurationBlock(transformName) {
  const note = configurationNote(transformName)
  return `## Configuration

Use \`transforms.${transformName}\` in the options passed to \`obfuscate\`:

\`\`\`js obfuscate.mjs highlight={3}
const output = obfuscate(source, {
  transforms: {
    ${transformName}: true,
  },
})
\`\`\`${note ? `\n\n${note}` : ''}`
}

// Only the passes that change behavior, or whose safety depends on the caller,
// get a callout. The behavior-preserving majority gets none.
function behaviorCallout(transformName) {
  if (transformName === 'dropConsole') {
    return `<Note>
  Dropping \`console.*(...)\` output is the point, so this changes behavior. It deletes the statement only when the arguments and any computed key are side-effect-free, so it never drops observable work. If any of them could do observable work, or \`console\` is shadowed or reassigned, it leaves the call alone.
</Note>`
  }

  if (transformName === 'dropDebugger') {
    return `<Note>
  Removing every \`debugger\` statement is the point, so this changes behavior.
</Note>`
  }

  if (transformName === 'mangleProperties') {
    return `<Warning>
  A renamed property can still be read from outside the input: another bundle, a JSON payload, a template, the DOM, or reflection. The obfuscator cannot see those uses, so this is safe only for names whose full boundary you control. Scope the selection with \`regex\`, \`reserved\`, annotations, or a reviewed \`cache\`.
</Warning>`
  }

  if (transformName === 'pack') {
    return `<Warning>
  \`pack\` throws on \`export\` statements, which cannot exist inside a \`Function\` body. It packs everything else as written. Code that needs \`import.meta\`, top-level await, dynamic \`import()\`, or a top-level \`arguments\` will not run once packed. And in a script, top-level \`var\` and function declarations stop publishing as global-object properties like \`globalThis.x\`.
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
  const { after, before, behavior, fileName, transformName } = transform
  const title = titles[transformName]
  if (!title) {
    throw new Error(`Add a documentation title for ${transformName}`)
  }

  const sourceUrl = `https://github.com/esoware/webfuscator/blob/main/packages/webfuscator/src/transforms/${fileName}`
  const testUrl = `https://github.com/esoware/webfuscator/blob/main/packages/webfuscator/tests/transforms/${fileName.replace(/\.ts$/u, '.test.ts')}`
  const callout = behaviorCallout(transformName)
  return `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(pageDescription(behavior))}
keywords: [${JSON.stringify(transformName)}, "JavaScript transform"]
---
{/* Generated by scripts/generate-transform-docs.mjs. Do not edit directly. */}

${optionBadge(transformName)}

${configurationBlock(transformName)}

## What it changes

${behavior}

${callout ? `${callout}\n\n` : ''}## Before and after

<CodeGroup>

\`\`\`js title="Before" lines
${before}
\`\`\`

\`\`\`js title="After" lines
${after}
\`\`\`

</CodeGroup>

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
const exportedNames = transforms.map(({ transformName }) => transformName).toSorted()

if (configuredNames.join('\n') !== exportedNames.join('\n')) {
  throw new Error(
    `TransformName and packages/webfuscator/src/transforms differ:\nconfigured: ${configuredNames.join(', ')}\nexported: ${exportedNames.join(', ')}`,
  )
}

const expectedFiles = new Set(transforms.map(({ fileName }) => fileName.replace(/\.ts$/u, '.mdx')))
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
