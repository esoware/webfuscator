import { Progress } from '@base-ui/react/progress'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { OutputPane } from './OutputPane'
import { SourcePane } from './SourcePane'
import type { SourcePaneProps } from './SourcePane'

interface WorkspaceProps extends SourcePaneProps {
  output: string
  error: string | null
  busy: boolean
}

/**
 * The inset window. The header, the options sidebar, and the status bar all sit
 * on the canvas, and this drops one step below it. That step is what separates
 * the editors from the chrome, since no border does.
 */
export function Workspace({ output, error, busy, ...sourcePane }: WorkspaceProps) {
  return (
    <main
      aria-label="Source and output"
      className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-inset ring-1 ring-line"
    >
      <Group orientation="horizontal" className="h-full min-h-0">
        <Panel defaultSize="50" minSize="20" className="min-w-0">
          <SourcePane {...sourcePane} />
        </Panel>

        <Separator className="group relative w-px shrink-0 cursor-col-resize bg-line outline-none">
          <div className="absolute inset-y-0 -left-1 w-2 transition-colors group-hover:bg-accent/60 group-active:bg-accent" />
        </Separator>

        <Panel defaultSize="50" minSize="20" className="min-w-0">
          <OutputPane output={output} error={error} />
        </Panel>
      </Group>

      {busy && (
        <Progress.Root
          value={null}
          aria-label="Obfuscating"
          className="animate-appear pointer-events-none absolute inset-x-0 top-0 z-20 opacity-0"
        >
          <Progress.Track className="h-0.5 w-full overflow-hidden">
            <Progress.Indicator className="animate-sweep h-full w-1/5 rounded-full bg-accent-soft" />
          </Progress.Track>
        </Progress.Root>
      )}
    </main>
  )
}
