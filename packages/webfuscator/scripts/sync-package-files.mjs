import * as fs from 'node:fs'
import * as path from 'node:path'

const packageDirectory = path.join(import.meta.dirname, '..')
const repositoryDirectory = path.join(packageDirectory, '..', '..')
const packageFiles = ['README.md', 'LICENSE', 'DISCLOSURE']

const [mode, ...extraArguments] = process.argv.slice(2)
if ((mode !== undefined && mode !== '--check') || extraArguments.length > 0) {
  throw new Error('Usage: node scripts/sync-package-files.mjs [--check]')
}

if (mode === '--check') {
  const staleFiles = packageFiles.filter((file) => {
    const source = path.join(repositoryDirectory, file)
    const destination = path.join(packageDirectory, file)
    return (
      !fs.existsSync(destination) || !fs.readFileSync(source).equals(fs.readFileSync(destination))
    )
  })

  if (staleFiles.length > 0) {
    throw new Error(
      `Package files are missing or stale: ${staleFiles.join(', ')}. Run pnpm package-files:sync.`,
    )
  }
} else {
  for (const file of packageFiles) {
    fs.copyFileSync(path.join(repositoryDirectory, file), path.join(packageDirectory, file))
  }
}
