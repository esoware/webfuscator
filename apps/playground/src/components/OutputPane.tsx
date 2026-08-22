import { useEffect, useRef, useState } from 'react'

import { Button } from './Button'
import { CodeEditor } from './CodeEditor'
import { CheckIcon, CopyIcon, DownloadIcon } from './Icons'

interface OutputPaneProps {
  output: string
  error: string | null
}

export function OutputPane({ output, error }: OutputPaneProps) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current)
      }
    },
    [],
  )

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      const pending = resetTimerRef.current
      if (pending !== null) {
        clearTimeout(pending)
      }
      resetTimerRef.current = setTimeout(() => {
        setCopied(false)
      }, 1500)
    } catch {
      // Clipboard permission denied. Selecting the output by hand still works.
    }
  }

  const handleDownload = () => {
    const blob = new Blob([output], { type: 'text/javascript;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'obfuscated.js'
    document.body.append(anchor)
    anchor.click()
    // Firefox and Safari start the transfer after the click handler returns, so
    // revoking on this tick gives them a dead URL and an empty file.
    setTimeout(() => {
      anchor.remove()
      URL.revokeObjectURL(url)
    }, 0)
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-chrome pr-1.5 pl-4">
        <h2 className="text-[13px] font-medium text-zinc-400">Output</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" disabled={output === ''} onClick={handleCopy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="secondary" disabled={output === ''} onClick={handleDownload}>
            <DownloadIcon />
            Download
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <CodeEditor path="output" value={output} readOnly />
        {output === '' && error === null && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-zinc-600">
            Press Obfuscate to fill this pane.
          </p>
        )}
      </div>

      {error !== null && (
        <div
          role="alert"
          className="max-h-32 shrink-0 overflow-y-auto border-t border-red-900/60 bg-red-950/40 px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-red-300"
        >
          {error}
        </div>
      )}
    </section>
  )
}
