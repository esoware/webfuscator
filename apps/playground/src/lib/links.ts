import type { TransformName } from 'webfuscator'

export const DOCS_URL = 'https://docs.webfuscator.dev'
export const GITHUB_URL = 'https://github.com/esoware/webfuscator'
export const NPM_URL = 'https://www.npmjs.com/package/webfuscator'

export function commitUrl(commit: string): string {
  return `${GITHUB_URL}/commit/${commit}`
}

/** Every transform reference page is named after its option in kebab case. */
export function transformDocsUrl(name: TransformName): string {
  const slug = name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)
  return `${DOCS_URL}/reference/transforms/${slug}`
}
