import { useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { ObfuscatorOptions } from 'webfuscator'

import { Header } from './components/Header'
import { OptionsPanel } from './components/OptionsPanel'
import { OutputPane } from './components/OutputPane'
import { SourcePane } from './components/SourcePane'
import type { TabId } from './components/SourcePane'
import { StatusBar } from './components/StatusBar'
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

  const handleConfigTextChange = (text: string) => {
    setConfigText(text)
    const result = parseConfig(text)
    setConfigResult(result)
    if (result.status === 'ok') {
      setOptions(result.options)
    }
  }

  const handleOptionsChange = (next: ObfuscatorOptions) => {
    setOptions(next)
    setConfigText(serializeOptions(next))
    setConfigResult(null)
  }

  const handleOptionsReset = () => {
    handleOptionsChange(defaultWorkspace().options)
  }

  const handleSourceReset = () => {
    setSource(defaultWorkspace().source)
  }

  const warnings = configResult?.status === 'ok' ? configResult.warnings : []
  // Both fields are replaced rather than mutated, so identity is enough here.
  const stale = ranWith !== null && (ranWith.source !== source || ranWith.options !== options)

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <Header
        runOnChange={runOnChange}
        onRunOnChangeToggle={setRunOnChange}
        onRun={() => {
          setRequested((count) => count + 1)
        }}
        stale={stale}
      />

      <div className="flex min-h-0 flex-1">
        <OptionsPanel
          options={options}
          onChange={handleOptionsChange}
          onReset={handleOptionsReset}
        />

        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel defaultSize="50" minSize="20">
            <SourcePane
              tab={tab}
              onTabChange={setTab}
              source={source}
              onSourceChange={setSource}
              onSourceReset={handleSourceReset}
              configText={configText}
              onConfigTextChange={handleConfigTextChange}
              configResult={configResult}
            />
          </Panel>

          <Separator className="group relative w-px shrink-0 bg-line outline-none">
            <div className="absolute inset-y-0 -left-1 w-2 transition-colors group-hover:bg-blue-600/60 group-active:bg-blue-500" />
          </Separator>

          <Panel defaultSize="50" minSize="20">
            <OutputPane output={obfuscation.output} error={obfuscation.error} />
          </Panel>
        </Group>
      </div>

      <StatusBar warnings={warnings} />
    </div>
  )
}
