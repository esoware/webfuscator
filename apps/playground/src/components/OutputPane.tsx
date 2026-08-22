import { Toolbar } from '@base-ui/react/toolbar'
import { useEffect, useRef, useState } from 'react'

import { CheckIcon, CopyIcon, DownloadIcon } from '../lib/icons'
import { ErrorBanner } from './Banner'
import { Button } from './Button'
import { CodeEditor } from './CodeEditor'

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
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 bg-frame pr-1.5 pl-3.5">
        <h2 className="text-sm font-medium text-fg-muted">Output</h2>
        <Toolbar.Root aria-label="Output actions" className="flex items-center gap-1">
          <Toolbar.Button
            render={<Button variant="ghost" />}
            disabled={output === ''}
            onClick={handleCopy}
          >
            {copied ? <CheckIcon size={14} aria-hidden /> : <CopyIcon size={14} aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </Toolbar.Button>
          <Toolbar.Button
            render={<Button variant="secondary" />}
            disabled={output === ''}
            onClick={handleDownload}
          >
            <DownloadIcon size={14} aria-hidden />
            Download
          </Toolbar.Button>
        </Toolbar.Root>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <CodeEditor path="output" value={output} readOnly />
          {output === '' && error === null && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">
              Press Obfuscate to fill this pane.
            </p>
          )}
        </div>

        {error !== null && <ErrorBanner message={error} />}
      </div>

      <output className="sr-only">{copied ? 'Output copied to the clipboard' : ''}</output>
    </section>
  )
}
