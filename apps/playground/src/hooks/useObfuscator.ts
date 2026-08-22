import { useCallback, useEffect, useRef, useState } from 'react'
import type { ObfuscatorOptions } from 'webfuscator'

import ObfuscatorWorker from '../lib/obfuscator.worker?worker'
import type { ObfuscateResponse } from '../lib/obfuscator.worker'

export interface Obfuscation {
  output: string
  error: string | null
  busy: boolean
  run: (code: string, options: ObfuscatorOptions) => void
}

export function useObfuscator(): Obfuscation {
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const busyRef = useRef(false)
  const jobRef = useRef(0)

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
      // Terminating ends the run. A flag left set here would make the next
      // `run` cancel a job that is already gone, which is what StrictMode's
      // teardown and remount would hit.
      busyRef.current = false
      setBusy(false)
    },
    [],
  )

  // `run` reads the ref before React has rendered the state, so write both here.
  const setRunning = useCallback((running: boolean) => {
    busyRef.current = running
    setBusy(running)
  }, [])

  /**
   * Callers list this in an effect's dependencies, so it has to keep its identity.
   * A new closure per render re-runs that effect, and with run-on-change enabled
   * every pass kills the worker and starts another one, forever.
   */
  const run = useCallback(
    (code: string, options: ObfuscatorOptions) => {
      // `obfuscate` is synchronous, so a worker mid-run never reads its inbox.
      // Terminating it is the only way to stop one.
      if (busyRef.current) {
        workerRef.current?.terminate()
        workerRef.current = null
        setRunning(false)
      }

      let worker = workerRef.current
      if (worker === null) {
        const started = new ObfuscatorWorker()
        started.addEventListener('message', (event: MessageEvent<ObfuscateResponse>) => {
          const response = event.data
          if (response.id !== jobRef.current) {
            return
          }
          setRunning(false)
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
        // A worker that fails to load or dies mid-run posts nothing back.
        // Without this the spinner and `aria-busy` stay on for good.
        started.addEventListener('error', (event) => {
          started.terminate()
          workerRef.current = null
          setRunning(false)
          setOutput('')
          setError(event.message === '' ? 'The obfuscator worker stopped.' : event.message)
        })
        workerRef.current = started
        worker = started
      }

      jobRef.current += 1
      setRunning(true)
      worker.postMessage({ id: jobRef.current, code, options })
    },
    [setRunning],
  )

  return { output, error, busy, run }
}
