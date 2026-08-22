/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Version of the `webfuscator` package this build bundled. */
  readonly WEBFUSCATOR_VERSION: string
  /** Short commit the build came from, or `null` outside a checkout. */
  readonly BUILD_COMMIT: string | null
}
