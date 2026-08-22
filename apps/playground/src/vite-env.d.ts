/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly WEBFUSCATOR_VERSION: string
  /** Short SHA, or `null` when the build had no git history. */
  readonly BUILD_COMMIT: string | null
}
