import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  // Relative so the build works from a sub-path as well as from a domain root.
  // Nothing here routes, so there is no deep URL for a relative asset to miss.
  base: './',
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
