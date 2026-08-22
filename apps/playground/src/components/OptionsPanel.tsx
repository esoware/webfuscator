import { Accordion } from '@base-ui/react/accordion'
import { Field } from '@base-ui/react/field'
import { Input } from '@base-ui/react/input'
import { ScrollArea } from '@base-ui/react/scroll-area'
import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ObfuscatorOptions } from 'webfuscator'

import { ChevronRightIcon, CloseIcon, SearchIcon } from '../lib/icons'
import { displayMode, modeChoices } from '../lib/modes'
import { TRANSFORM_GROUPS, isStringGeneratorMode } from '../lib/schema'
import type { TransformGroup } from '../lib/schema'
import { isEntryEnabled, mergePatch } from '../lib/transformEntry'
import type { PatchOf } from '../lib/transformEntry'
import { Button } from './Button'
import { NumberSpinner, SelectField, SwitchField } from './Fields'
import { Hint } from './Tooltip'
import { TransformRow } from './TransformRow'

const GENERAL = 'General'

interface OptionsPanelProps {
  options: ObfuscatorOptions
  onChange: (next: ObfuscatorOptions) => void
  onReset: () => void
}

/** A source keystroke re-renders the app. Rebuilding every transform row costs more. */
export const OptionsPanel = memo(OptionsPanelContent)

function OptionsPanelContent({ options, onChange, onReset }: OptionsPanelProps) {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string[]>(() => [
    GENERAL,
    ...TRANSFORM_GROUPS.map((group) => group.title),
  ])

  const query = filter.trim().toLowerCase()
  const searching = query !== ''
  const groups = matchingGroups(query)

  const patchOptions = (patch: PatchOf<ObfuscatorOptions>) => {
    onChange(mergePatch(options, patch))
  }

  const globalMode = options.stringGeneratorMode

  return (
    // Wide enough for `functionDeclarationToExpression`, the longest name.
    <aside aria-label="Options" className="hidden w-88 shrink-0 flex-col lg:flex">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 pr-1.5 pl-2.5">
        <h2 className="text-sm font-semibold text-fg-strong">Options</h2>
        <Hint content="Restore the starter preset">
          <Button variant="ghost" aria-label="Reset options" onClick={onReset}>
            Reset
          </Button>
        </Hint>
      </div>

      <div className="shrink-0 px-2 pb-2">
        <FilterInput value={filter} onChange={setFilter} />
      </div>

      <ScrollArea.Root className="relative min-h-0 flex-1">
        {/* Pinned rather than sized with `h-full`, which resolves against an ancestor
            height this flex chain does not settle. Unpinned it grows to its content
            and drags the whole page taller than the canvas. */}
        <ScrollArea.Viewport className="absolute inset-0 focus-visible:-outline-offset-2">
          <ScrollArea.Content className="px-2 pb-4">
            <Accordion.Root
              multiple
              value={searching ? groups.map((group) => group.title) : expanded}
              onValueChange={(next) => {
                if (!searching) {
                  setExpanded(next)
                }
              }}
            >
              {!searching && (
                <Group title={GENERAL}>
                  <div className="pr-1.5 pl-5">
                    <SwitchField
                      label="Minify output"
                      hint="Print Babel's minified output instead of formatted JavaScript"
                      checked={options.minify === true}
                      onChange={(checked) => {
                        patchOptions({ minify: checked || undefined })
                      }}
                    />
                    <NumberSpinner
                      label="Seed"
                      hint="The same seed produces the same output. Drag this label to scrub."
                      value={options.seed ?? 0}
                      min={0}
                      onChange={(seed) => {
                        patchOptions({ seed: seed === 0 ? undefined : seed })
                      }}
                    />
                    <SelectField
                      label="Name style"
                      hint="stringGeneratorMode: the default style for every generated name"
                      options={modeChoices(globalMode, false)}
                      // Unset means the library's `mangled`, and this select offers no `inherit`.
                      value={displayMode(globalMode ?? 'mangled')}
                      onChange={(choice) => {
                        if (isStringGeneratorMode(choice)) {
                          patchOptions({
                            stringGeneratorMode: choice === 'mangled' ? undefined : choice,
                          })
                        }
                      }}
                    />
                  </div>
                </Group>
              )}

              {groups.map((group) => (
                <Group
                  key={group.title}
                  title={group.title}
                  enabled={
                    group.transforms.filter((spec) =>
                      isEntryEnabled(options.transforms?.[spec.name]),
                    ).length
                  }
                  total={group.transforms.length}
                >
                  {group.transforms.map((spec) => (
                    <TransformRow
                      key={spec.name}
                      spec={spec}
                      options={options}
                      onChange={onChange}
                    />
                  ))}
                </Group>
              ))}
            </Accordion.Root>

            {groups.length === 0 && (
              <p className="px-2 py-10 text-center text-sm text-fg-subtle">
                Nothing matches that filter.
              </p>
            )}
          </ScrollArea.Content>
        </ScrollArea.Viewport>

        <ScrollArea.Scrollbar
          orientation="vertical"
          className="flex w-2.5 touch-none justify-center py-1 opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100 data-scrolling:duration-0"
        >
          <ScrollArea.Thumb className="w-1 rounded-full bg-neutral-700 transition-colors hover:bg-neutral-600" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </aside>
  )
}

function matchingGroups(query: string): readonly TransformGroup[] {
  if (query === '') {
    return TRANSFORM_GROUPS
  }
  const groups: TransformGroup[] = []
  for (const group of TRANSFORM_GROUPS) {
    const transforms = group.transforms.filter(
      (spec) =>
        spec.name.toLowerCase().includes(query) || spec.description.toLowerCase().includes(query),
    )
    if (transforms.length > 0) {
      groups.push({ title: group.title, transforms })
    }
  }
  return groups
}

interface GroupProps {
  title: string
  enabled?: number
  total?: number
  children: ReactNode
}

function Group({ title, enabled, total, children }: GroupProps) {
  return (
    <Accordion.Item value={title}>
      <Accordion.Header>
        <Accordion.Trigger className="group flex w-full items-center rounded-xl py-1.5 pr-2.5 text-left transition-colors hover:bg-tint">
          {/* Centered in its slot, otherwise the rotation pivots off the glyph. */}
          <span className="inline-flex w-5 shrink-0 items-center justify-center text-fg-subtle transition-transform group-data-panel-open:rotate-90">
            <ChevronRightIcon size={14} aria-hidden />
          </span>
          <span className="truncate text-sm font-semibold text-fg-strong">{title}</span>
          {/* Collapsed, this is the only sign a group holds anything active. */}
          {total !== undefined && (
            <span
              aria-label={`${enabled} of ${total} enabled`}
              className="ml-auto shrink-0 pl-2 text-xs text-fg-faint tabular-nums"
            >
              {enabled}/{total}
            </span>
          )}
        </Accordion.Trigger>
      </Accordion.Header>

      {/* The docs run every height change at 300ms and everything else at the
          150ms default, including chevrons. */}
      <Accordion.Panel className="h-(--accordion-panel-height) overflow-hidden transition-[height] duration-300 ease-in-out data-ending-style:h-0 data-starting-style:h-0">
        <div className="pt-0.5 pb-2">{children}</div>
      </Accordion.Panel>
    </Accordion.Item>
  )
}

function FilterInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field.Root className="relative">
      <Field.Label className="sr-only">Filter transforms</Field.Label>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted">
        <SearchIcon size={16} aria-hidden />
      </span>
      <Input
        value={value}
        placeholder="Filter transforms"
        onValueChange={onChange}
        className="h-9 w-full rounded-xl bg-frame pr-9 pl-9 text-sm text-fg ring-1 ring-line transition-shadow placeholder:text-fg-subtle hover:ring-line-strong"
      />
      {value !== '' && (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => {
            onChange('')
          }}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-fg-subtle transition-colors hover:bg-fill-hover hover:text-fg"
        >
          <CloseIcon size={14} aria-hidden />
        </button>
      )}
    </Field.Root>
  )
}
