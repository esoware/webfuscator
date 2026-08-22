import { Tabs } from '@base-ui/react/tabs'

import type { ConfigParseResult } from '../lib/config'
import { ErrorBanner } from './Banner'
import { Button } from './Button'
import { CodeEditor } from './CodeEditor'
import { Hint } from './Tooltip'

export type TabId = 'source' | 'config'

export interface SourcePaneProps {
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
    <Tabs.Root
      className="flex h-full min-h-0 flex-col"
      value={tab}
      onValueChange={(value) => {
        onTabChange(value === 'config' ? 'config' : 'source')
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 bg-frame pr-1.5 pl-1.5">
        <Tabs.List aria-label="Input" className="relative isolate flex items-center gap-0.5">
          <Tabs.Indicator className="absolute top-0 left-0 -z-10 h-full w-(--active-tab-width) translate-x-(--active-tab-left) rounded-xl bg-fill transition-[translate,width]" />
          <Tabs.Tab
            value="source"
            className="relative z-10 flex h-9 items-center rounded-xl px-3 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors select-none hover:text-fg data-active:text-fg-strong"
          >
            Source
          </Tabs.Tab>
          <Tabs.Tab
            value="config"
            className="relative z-10 flex h-9 items-center rounded-xl px-3 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors select-none hover:text-fg data-active:text-fg-strong"
          >
            Config
          </Tabs.Tab>
        </Tabs.List>

        <span className="flex-1" />

        {tab === 'source' ? (
          <Hint content="Restore the sample source">
            {/* The options panel has a Reset too, and a tooltip does not count
                toward an accessible name. Both labels start with the visible
                word so a voice command on "Reset" still reaches them. */}
            <Button variant="ghost" aria-label="Reset source" onClick={onSourceReset}>
              Reset
            </Button>
          </Hint>
        ) : (
          <span className="pr-2 text-xs text-fg-faint">Evaluated as an object literal</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* The focus ring draws inward on both panels. The panel runs to the edge
            of the window, so an outward ring would land on the canvas. */}
        <Tabs.Panel
          keepMounted
          value="source"
          className="min-h-0 flex-1 focus-visible:-outline-offset-2 [&[hidden]]:hidden"
        >
          <CodeEditor path="source" value={source} onChange={onSourceChange} />
        </Tabs.Panel>
        {/* Not kept mounted like the source panel. Most sessions never open this
            tab, so a second Monaco instance is not worth building at first paint. */}
        <Tabs.Panel
          value="config"
          className="min-h-0 flex-1 focus-visible:-outline-offset-2 [&[hidden]]:hidden"
        >
          <CodeEditor path="config" value={configText} onChange={onConfigTextChange} />
        </Tabs.Panel>

        {tab === 'config' && <ConfigBanner result={configResult} />}
      </div>
    </Tabs.Root>
  )
}

function ConfigBanner({ result }: { result: ConfigParseResult | null }) {
  if (result === null) {
    return null
  }
  if (result.status === 'error') {
    return <ErrorBanner message={result.message} />
  }
  if (result.warnings.length === 0) {
    return null
  }
  return (
    <div className="max-h-32 shrink-0 space-y-0.5 overflow-y-auto border-t border-warning-line bg-warning-fill px-3.5 py-2 text-xs text-warning">
      {result.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </div>
  )
}
