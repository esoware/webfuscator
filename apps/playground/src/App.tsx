import { Tooltip } from '@base-ui/react/tooltip'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ObfuscatorOptions } from 'webfuscator'

import { Header } from './components/Header'
import { OptionsPanel } from './components/OptionsPanel'
import type { TabId } from './components/SourcePane'
import { StatusBar } from './components/StatusBar'
import { Workspace } from './components/Workspace'
import { useObfuscator } from './hooks/useObfuscator'
import { parseConfig, serializeOptions } from './lib/config'
import type { ConfigParseResult } from './lib/config'
import { defaultWorkspace, loadWorkspace, saveWorkspace } from './lib/storage'

interface RunInput {
  source: string
  options: ObfuscatorOptions
}

export default function App() {
  // No setter because nothing rewrites what was in storage at startup.
  // oxlint-disable-next-line react/hook-use-state
  const [initial] = useState(() => ({ ...defaultWorkspace(), ...loadWorkspace() }))

  const [tab, setTab] = useState<TabId>('source')
  const [source, setSource] = useState(initial.source)
  const [options, setOptions] = useState<ObfuscatorOptions>(initial.options)
  const [runOnChange, setRunOnChange] = useState(initial.runOnChange)
  const [configText, setConfigText] = useState(() => serializeOptions(initial.options))
  const [configResult, setConfigResult] = useState<ConfigParseResult | null>(null)
  const [ranWith, setRanWith] = useState<RunInput | null>(null)

  const obfuscation = useObfuscator()
  const { run } = obfuscation

  // Every trigger bumps this instead of calling the worker, so no callback here
  // has to hold a stable identity for the effect below.
  const [requested, setRequested] = useState(0)

  const primedRef = useRef(false)
  const servedRef = useRef(0)
  useEffect(() => {
    const asked = servedRef.current !== requested
    servedRef.current = requested
    if (primedRef.current && !runOnChange && !asked) {
      return
    }
    primedRef.current = true
    // The worker is the external system this effect syncs with.
    // oxlint-disable-next-line react/set-state-in-effect
    setRanWith({ source, options })
    run(source, options)
  }, [run, requested, runOnChange, source, options])

  // StrictMode tears the app down and rebuilds it once, and the teardown takes
  // the worker with it. Without this the first run is lost and the output pane
  // sits empty in development until someone presses Obfuscate.
  useEffect(
    () => () => {
      primedRef.current = false
    },
    [],
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      saveWorkspace({ source, options, runOnChange })
    }, 500)
    return () => {
      clearTimeout(timer)
    }
  }, [source, options, runOnChange])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        setRequested((count) => count + 1)
      }
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => {
      globalThis.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // These close over setters only. Stable identities keep a source keystroke from
  // re-rendering the options panel and re-attaching the config editor's listener.
  const handleConfigTextChange = useCallback((text: string) => {
    setConfigText(text)
    const result = parseConfig(text)
    setConfigResult(result)
    if (result.status === 'ok') {
      setOptions(result.options)
    }
  }, [])

  const handleOptionsChange = useCallback((next: ObfuscatorOptions) => {
    setOptions(next)
    setConfigText(serializeOptions(next))
    setConfigResult(null)
  }, [])

  const handleOptionsReset = useCallback(() => {
    handleOptionsChange(defaultWorkspace().options)
  }, [handleOptionsChange])

  const warnings = configResult?.status === 'ok' ? configResult.warnings : []
  // Both fields are replaced rather than mutated, so identity is enough here.
  const stale = ranWith !== null && (ranWith.source !== source || ranWith.options !== options)

  return (
    <Tooltip.Provider delay={400} closeDelay={80}>
      <div className="flex h-dvh flex-col">
        <Header
          runOnChange={runOnChange}
          onRunOnChangeToggle={setRunOnChange}
          onRun={() => {
            setRequested((count) => count + 1)
          }}
          stale={stale}
          busy={obfuscation.busy}
        />

        {/* No vertical padding. The bars already center their contents, so a gap
            here lands on one side of the text and breaks the symmetry. */}
        <div className="flex min-h-0 flex-1 gap-4 px-4">
          <OptionsPanel
            options={options}
            onChange={handleOptionsChange}
            onReset={handleOptionsReset}
          />

          <Workspace
            tab={tab}
            onTabChange={setTab}
            source={source}
            onSourceChange={setSource}
            onSourceReset={() => {
              setSource(defaultWorkspace().source)
            }}
            configText={configText}
            onConfigTextChange={handleConfigTextChange}
            configResult={configResult}
            output={obfuscation.output}
            error={obfuscation.error}
            busy={obfuscation.busy}
          />
        </div>

        <StatusBar
          warnings={warnings}
          onShowWarnings={() => {
            setTab('config')
          }}
        />
      </div>
    </Tooltip.Provider>
  )
}
