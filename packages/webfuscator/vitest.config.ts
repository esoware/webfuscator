import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Deep parser tests exhaust Node's default stack. Only forked workers accept
    // the V8 stack-size flag.
    pool: 'forks',
    execArgv: ['--stack-size=4000'],
  },
})
