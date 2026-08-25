import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

const packageDirectory = path.join(import.meta.dirname, '..')
const releaseDirectory = path.join(packageDirectory, '.release')
const stageDirectory = path.join(releaseDirectory, 'stage')
const manifest = JSON.parse(fs.readFileSync(path.join(stageDirectory, 'package.json'), 'utf8'))
const tarballName = `${manifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${manifest.version}.tgz`
const tarballPath = path.join(releaseDirectory, tarballName)
const pnpm = process.env.npm_execpath

if (!pnpm) {
  throw new Error('package:pack must run through pnpm')
}

fs.rmSync(tarballPath, { force: true })

const packed = spawnSync(process.execPath, [pnpm, 'pack', '--json', '--out', tarballPath], {
  cwd: stageDirectory,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})

if (packed.status !== 0) {
  throw packed.error ?? new Error(`pnpm pack exited with status ${packed.status}`)
}

const result = JSON.parse(packed.stdout)
const packageResult = Array.isArray(result) ? result[0] : result
const files = packageResult.files.map((file) => (typeof file === 'string' ? file : file.path))
const integrity = `sha512-${createHash('sha512')
  .update(fs.readFileSync(tarballPath))
  .digest('base64')}`

fs.writeFileSync(
  path.join(releaseDirectory, 'artifact.json'),
  `${JSON.stringify(
    {
      files,
      integrity,
      name: manifest.name,
      tarball: tarballName,
      version: manifest.version,
    },
    null,
    2,
  )}\n`,
)

console.log(tarballPath)
