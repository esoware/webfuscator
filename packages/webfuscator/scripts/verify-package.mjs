import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const packageDirectory = path.join(import.meta.dirname, '..')
const repositoryDirectory = path.join(packageDirectory, '..', '..')
const releaseDirectory = path.join(packageDirectory, '.release')
const stageDirectory = path.join(releaseDirectory, 'stage')
const metadataFiles = ['README.md', 'LICENSE', 'DISCLOSURE']
const artifact = JSON.parse(fs.readFileSync(path.join(releaseDirectory, 'artifact.json'), 'utf8'))
const tarballPath = path.join(releaseDirectory, artifact.tarball)

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walk(fullPath)
    } else {
      yield fullPath
    }
  }
}

function sortedRelativeFiles(directory) {
  return [...walk(directory)]
    .map((file) => path.relative(directory, file).split(path.sep).join('/'))
    .toSorted()
}

function assertEqualFiles(actual, expected) {
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error(
      `Packed files differ from staging:\nactual: ${actual.join(', ')}\nexpected: ${expected.join(', ')}`,
    )
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`)
  }
}

const sourceManifest = JSON.parse(
  fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
)
if (artifact.name !== sourceManifest.name || artifact.version !== sourceManifest.version) {
  throw new Error('Artifact identity does not match packages/webfuscator/package.json')
}

const integrity = `sha512-${createHash('sha512')
  .update(fs.readFileSync(tarballPath))
  .digest('base64')}`
if (integrity !== artifact.integrity) {
  throw new Error(
    `Tarball integrity changed: expected ${artifact.integrity}, received ${integrity}`,
  )
}

const packedFiles = artifact.files.toSorted()
const stagedFiles = sortedRelativeFiles(stageDirectory)
assertEqualFiles(packedFiles, stagedFiles)

for (const file of packedFiles) {
  if (
    file !== 'package.json' &&
    !metadataFiles.includes(file) &&
    !file.startsWith('dist/') &&
    !file.startsWith('src/')
  ) {
    throw new Error(`Unexpected package file: ${file}`)
  }
}

for (const file of metadataFiles) {
  const canonical = fs.readFileSync(path.join(repositoryDirectory, file))
  const staged = fs.readFileSync(path.join(stageDirectory, file))
  if (!canonical.equals(staged)) {
    throw new Error(`${file} differs from the repository root`)
  }
}

if (!packedFiles.some((file) => file.startsWith('dist/'))) {
  throw new Error('Tarball contains no dist files')
}
if (!packedFiles.some((file) => file.startsWith('src/'))) {
  throw new Error('Tarball contains no source files')
}

const smokeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'webfuscator-smoke-'))
const pnpm = process.env.npm_execpath
const relativeSmokeDirectory = path.relative(os.tmpdir(), smokeDirectory)

if (!pnpm) {
  throw new Error('package:verify must run through pnpm')
}
if (
  path.isAbsolute(relativeSmokeDirectory) ||
  relativeSmokeDirectory.startsWith('..') ||
  !path.basename(smokeDirectory).startsWith('webfuscator-smoke-')
) {
  throw new Error(`Unexpected smoke directory: ${smokeDirectory}`)
}

try {
  fs.writeFileSync(
    path.join(smokeDirectory, 'package.json'),
    `${JSON.stringify(
      {
        dependencies: { webfuscator: pathToFileURL(tarballPath).href },
        private: true,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  )

  run(
    process.execPath,
    [pnpm, 'install', '--frozen-lockfile=false', '--ignore-scripts'],
    smokeDirectory,
  )

  const installedPackage = path.join(smokeDirectory, 'node_modules', 'webfuscator')
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(installedPackage, 'package.json'), 'utf8'),
  )
  if (installedManifest.version !== artifact.version) {
    throw new Error(
      `Installed version is ${installedManifest.version}, expected ${artifact.version}`,
    )
  }

  for (const file of metadataFiles) {
    const canonical = fs.readFileSync(path.join(repositoryDirectory, file))
    const installed = fs.readFileSync(path.join(installedPackage, file))
    if (!canonical.equals(installed)) {
      throw new Error(`Installed ${file} differs from the repository root`)
    }
  }

  const entry = pathToFileURL(path.join(installedPackage, 'dist', 'index.js')).href
  const { obfuscate } = await import(entry)
  const output = obfuscate('var packageSmoke = 42;', {
    transforms: { renameIdentifiers: true },
  })
  if (typeof output !== 'string' || output.includes('packageSmoke')) {
    throw new Error(`Installed package produced an unexpected result:\n${output}`)
  }
} finally {
  fs.rmSync(smokeDirectory, { force: true, recursive: true })
}

console.log(`${tarballPath}\n${integrity}`)
