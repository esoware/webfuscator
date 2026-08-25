import * as fs from 'node:fs'
import * as path from 'node:path'

const packageDirectory = path.join(import.meta.dirname, '..')
const repositoryDirectory = path.join(packageDirectory, '..', '..')
const stageDirectory = path.join(packageDirectory, '.release', 'stage')
const metadataFiles = ['README.md', 'LICENSE', 'DISCLOSURE']

for (const file of metadataFiles) {
  const duplicate = path.join(packageDirectory, file)
  if (fs.existsSync(duplicate)) {
    throw new Error(`${duplicate} must remain canonical at the repository root`)
  }
}

fs.rmSync(stageDirectory, { force: true, recursive: true })
fs.mkdirSync(stageDirectory, { recursive: true })

for (const directory of ['dist', 'src']) {
  fs.cpSync(path.join(packageDirectory, directory), path.join(stageDirectory, directory), {
    recursive: true,
  })
}

for (const file of metadataFiles) {
  fs.copyFileSync(path.join(repositoryDirectory, file), path.join(stageDirectory, file))
}

const manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'))
delete manifest.devDependencies
delete manifest.scripts

fs.writeFileSync(
  path.join(stageDirectory, 'package.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
