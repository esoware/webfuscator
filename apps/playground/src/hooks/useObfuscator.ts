import { useEffect, useRef, useState } from 'react'
import type { ObfuscatorOptions } from 'webfuscator'

import ObfuscatorWorker from '../lib/obfuscator.worker?worker'
import type { ObfuscateResponse } from '../lib/obfuscator.worker'

export interface Obfuscation {
  output: string
  error: string | null
  run: (code: string, options: ObfuscatorOptions) => void
}

export function useObfuscator(): Obfuscation {
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const busyRef = useRef(false)
  const jobRef = useRef(0)

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  const run = (code: string, options: ObfuscatorOptions) => {
    // `obfuscate` is synchronous, so a worker mid-run never reads its inbox.
    // Terminating it is the only way to stop one.
    if (busyRef.current) {
      workerRef.current?.terminate()
      workerRef.current = null
      busyRef.current = false
    }

    let worker = workerRef.current
    if (worker === null) {
      worker = new ObfuscatorWorker()
      worker.addEventListener('message', (event: MessageEvent<ObfuscateResponse>) => {
        const response = event.data
        if (response.id !== jobRef.current) {
          return
        }
        busyRef.current = false
        if (response.status === 'ok') {
          setOutput(response.code)
          setError(null)
        } else {
          // Keeping the last good run would leave Copy and Download over code
          // the current source did not produce.
          setOutput('')
          setError(response.message)
        }
      })
      workerRef.current = worker
    }

    jobRef.current += 1
    busyRef.current = true
    worker.postMessage({ id: jobRef.current, code, options })
  }

  return { output, error, run }
}
