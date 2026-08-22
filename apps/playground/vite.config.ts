import { execSync } from 'node:child_process'
import * as fs from 'node:fs'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

const manifest = new URL('../../packages/webfuscator/package.json', import.meta.url)
const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version as string

// The site deploys from main, so the version alone cannot identify a build.
function buildCommit(): string | null {
  const fromWorkflow = process.env['GITHUB_SHA']
  if (fromWorkflow) {
    return fromWorkflow.slice(0, 7)
  }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    // No git history, so the stamp falls back to the version alone.
    return null
  }
}

export default defineConfig({
  // Relative so the build works from a sub-path as well as from a domain root.
  // Nothing here routes, so there is no deep URL for a relative asset to miss.
  base: './',
  define: {
    'import.meta.env.WEBFUSCATOR_VERSION': JSON.stringify(version),
    'import.meta.env.BUILD_COMMIT': JSON.stringify(buildCommit()),
  },
  plugins: [
    // `compiler` runs React Compiler through `oxc-transform-react`, the Rust
    // port, rather than pulling Babel into the frontend build. The plugin takes
    // over the JSX transform and Fast Refresh when it is on, and reports every
    // component it had to bail out of as a build warning.
    react({ compiler: true }),
    tailwindcss(),
  ],
  resolve: {
    // The `source` export condition bundles webfuscator from TypeScript, so the
    // playground never serves a stale `dist`.
    conditions: ['source', ...defaultClientConditions],
  },
  worker: {
    format: 'es',
  },
})
