import { Tooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

interface HintProps {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/** Replaces the `title` attribute, which touch devices never show and few screen readers read. */
export function Hint({ content, children, side = 'bottom' }: HintProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={8} className="z-50">
          <Tooltip.Popup className="max-w-72 origin-(--transform-origin) rounded-xl bg-overlay ring-1 ring-line-strong px-2.5 py-1.5 text-xs text-fg shadow-lg shadow-black/40 transition-[transform,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
