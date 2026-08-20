import * as path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { src: path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Deep parser tests exhaust Node's default stack. Only forked workers accept
    // the V8 stack-size flag.
    pool: 'forks',
    execArgv: ['--stack-size=4000'],
  },
})
