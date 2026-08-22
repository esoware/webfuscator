import { obfuscate } from 'webfuscator'
import type { ObfuscatorOptions } from 'webfuscator'

export interface ObfuscateRequest {
  id: number
  code: string
  options: ObfuscatorOptions
}

export type ObfuscateResponse =
  | { id: number; status: 'ok'; code: string }
  | { id: number; status: 'error'; message: string }

// The DOM lib types `globalThis` as `Window`, which a worker never is, so the
// cast below narrows it to the two members this file actually calls.
interface WorkerContext {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<ObfuscateRequest>) => void,
  ) => void
  postMessage: (message: ObfuscateResponse) => void
}

const context = globalThis as unknown as WorkerContext

context.addEventListener('message', (event) => {
  const id = event.data.id
  const code = event.data.code
  const options = event.data.options

  try {
    const output = obfuscate(code, options)
    context.postMessage({ id, status: 'ok', code: output })
  } catch (error) {
    context.postMessage({ id, status: 'error', message: describeError(error) })
  }
})

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
