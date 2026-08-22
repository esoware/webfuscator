import type { ConfigParseResult } from '../lib/config'
import { Button } from './Button'
import { CodeEditor } from './CodeEditor'

export type TabId = 'source' | 'config'

interface SourcePaneProps {
  tab: TabId
  onTabChange: (tab: TabId) => void
  source: string
  onSourceChange: (source: string) => void
  onSourceReset: () => void
  configText: string
  onConfigTextChange: (text: string) => void
  configResult: ConfigParseResult | null
}

export function SourcePane({
  tab,
  onTabChange,
  source,
  onSourceChange,
  onSourceReset,
  configText,
  onConfigTextChange,
  configResult,
}: SourcePaneProps) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-chrome pr-1.5 pl-2">
        <div role="tablist" aria-label="Input" className="flex h-full items-stretch">
          <Tab id="source" active={tab === 'source'} onSelect={onTabChange}>
            Source
          </Tab>
          <Tab id="config" active={tab === 'config'} onSelect={onTabChange}>
            Config
          </Tab>
        </div>
        <span className="flex-1" />
        {tab === 'source' ? (
          <Button variant="ghost" onClick={onSourceReset} title="Restore the sample source">
            Reset source
          </Button>
        ) : (
          <span className="pr-1.5 text-[12px] text-zinc-600">Evaluated as an object literal</span>
        )}
      </div>

      <div
        className="min-h-0 flex-1"
        role="tabpanel"
        aria-label={tab === 'source' ? 'Source' : 'Config'}
      >
        {tab === 'source' ? (
          <CodeEditor path="source" value={source} onChange={onSourceChange} />
        ) : (
          <CodeEditor path="config" value={configText} onChange={onConfigTextChange} />
        )}
      </div>

      {tab === 'config' && <ConfigBanner result={configResult} />}
    </section>
  )
}

function Tab({
  id,
  active,
  onSelect,
  children,
}: {
  id: TabId
  active: boolean
  onSelect: (tab: TabId) => void
  children: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => {
        onSelect(id)
      }}
      className={`relative px-3 text-[13px] font-medium transition-colors outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-blue-500 ${
        active ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-500" />}
    </button>
  )
}

function ConfigBanner({ result }: { result: ConfigParseResult | null }) {
  if (result === null) {
    return null
  }
  if (result.status === 'error') {
    return (
      <div
        role="alert"
        className="max-h-32 shrink-0 overflow-y-auto border-t border-red-900/60 bg-red-950/40 px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-red-300"
      >
        {result.message}
      </div>
    )
  }
  if (result.warnings.length === 0) {
    return null
  }
  return (
    <div className="max-h-32 shrink-0 space-y-0.5 overflow-y-auto border-t border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[12px] leading-relaxed text-amber-300/90">
      {result.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </div>
  )
}
