import { useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ManglePropertiesOptions,
  ObfuscatorOptions,
  PackOptions,
  StringGeneratorModeOption,
} from 'webfuscator'

import { transformDocsUrl } from '../lib/links'
import {
  KEEP_QUOTED_CHOICES,
  MANGLE_FLAGS,
  STRING_GENERATOR_MODES,
  TRANSFORM_GROUPS,
  isStringGeneratorMode,
} from '../lib/schema'
import type { TransformGroup, TransformSpec } from '../lib/schema'
import {
  editTransformEntry,
  entryMode,
  entryObject,
  mergePatch,
  patchTransformEntry,
} from '../lib/transformEntry'
import type { ModeOverride, PatchOf } from '../lib/transformEntry'
import { Button } from './Button'
import { CommitTextField, NumberField, SelectField } from './Fields'
import { CloseIcon, ExternalLinkIcon, SearchIcon } from './Icons'
import { Switch } from './Switch'

type MangleFlagKey = (typeof MANGLE_FLAGS)[number]['key']

interface SelectChoice {
  value: string
  label: string
}

function displayMode(value: StringGeneratorModeOption | undefined): string {
  if (value === undefined) {
    return 'inherit'
  }
  return typeof value === 'string' ? value : 'mixed'
}

function modeChoices(
  current: StringGeneratorModeOption | undefined,
  includeInherit: boolean,
): SelectChoice[] {
  const choices: SelectChoice[] = includeInherit ? [{ value: 'inherit', label: 'inherit' }] : []
  for (const mode of STRING_GENERATOR_MODES) {
    choices.push({ value: mode, label: mode })
  }
  if (Array.isArray(current)) {
    choices.push({ value: 'mixed', label: 'mixed' })
  }
  return choices
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

interface OptionsPanelProps {
  options: ObfuscatorOptions
  onChange: (next: ObfuscatorOptions) => void
  onReset: () => void
}

export function OptionsPanel({ options, onChange, onReset }: OptionsPanelProps) {
  const [filter, setFilter] = useState('')
  const query = filter.trim().toLowerCase()
  const groups = matchingGroups(query)

  const patchOptions = (patch: PatchOf<ObfuscatorOptions>) => {
    onChange(mergePatch(options, patch))
  }

  const globalMode = options.stringGeneratorMode

  return (
    // Wide enough for `functionDeclarationToExpression`, the longest name.
    <aside className="hidden w-[336px] shrink-0 flex-col border-r border-line bg-chrome lg:flex">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line pr-1.5 pl-4">
        <h2 className="text-[13px] font-semibold text-zinc-200">Options</h2>
        <Button variant="ghost" onClick={onReset} title="Restore the starter preset">
          Reset
        </Button>
      </div>

      <div className="shrink-0 border-b border-line p-2">
        <FilterInput value={filter} onChange={setFilter} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
        {query === '' && (
          <section>
            <GroupHeading title="General" />
            <div className="space-y-0.5 px-2 pb-2">
              <ToggleRow
                id="option-minify"
                label="Minify output"
                title="Print Babel's minified output instead of formatted JavaScript"
                checked={options.minify === true}
                onChange={(checked) => {
                  patchOptions({ minify: checked || undefined })
                }}
              />
              <NumberField
                label="Seed"
                title="The same seed produces the same output"
                value={options.seed ?? 0}
                min={0}
                onChange={(seed) => {
                  patchOptions({ seed: seed === 0 ? undefined : seed })
                }}
              />
              <SelectField
                label="Name style"
                title="stringGeneratorMode: the default style for generated names"
                options={modeChoices(globalMode, false)}
                value={displayMode(globalMode) === 'inherit' ? 'mangled' : displayMode(globalMode)}
                onChange={(choice) => {
                  if (!isStringGeneratorMode(choice)) {
                    return
                  }
                  patchOptions({ stringGeneratorMode: choice === 'mangled' ? undefined : choice })
                }}
              />
            </div>
          </section>
        )}

        {groups.map((group) => (
          <section key={group.title}>
            <GroupHeading
              title={group.title}
              enabled={group.transforms.filter((spec) => isEnabled(options, spec)).length}
              total={group.transforms.length}
            />
            {group.transforms.map((spec) => {
              const entry = options.transforms?.[spec.name]
              const enabled = entry !== undefined && entry !== false
              const patchDetails = <T extends object>(patch: PatchOf<T>) => {
                onChange(patchTransformEntry(options, spec.name, entry, patch))
              }
              const setOverride = (choice: string) => {
                if (choice === 'inherit') {
                  patchDetails<ModeOverride>({ stringGeneratorMode: undefined })
                  return
                }
                if (isStringGeneratorMode(choice)) {
                  patchDetails<ModeOverride>({ stringGeneratorMode: choice })
                }
              }

              return (
                <div key={spec.name}>
                  <TransformToggle
                    spec={spec}
                    checked={enabled}
                    onChange={(checked) => {
                      onChange(editTransformEntry(options, spec.name, checked ? true : undefined))
                    }}
                  />

                  {enabled && spec.kind === 'mode' && (
                    <Details>
                      <SelectField
                        label="Name style"
                        title="Override the global generator style for this transform"
                        options={modeChoices(entryMode(entry), true)}
                        value={displayMode(entryMode(entry))}
                        onChange={setOverride}
                      />
                    </Details>
                  )}

                  {enabled && spec.kind === 'mangle' && (
                    <MangleDetails
                      mangle={entryObject<ManglePropertiesOptions>(entry)}
                      override={entryMode(entry)}
                      onOverride={setOverride}
                      onPatch={patchDetails}
                    />
                  )}

                  {enabled && spec.kind === 'pack' && (
                    <PackDetails
                      pack={entryObject<PackOptions>(entry)}
                      override={entryMode(entry)}
                      onOverride={setOverride}
                      onPatch={patchDetails}
                    />
                  )}
                </div>
              )
            })}
          </section>
        ))}

        {groups.length === 0 && (
          <p className="px-2 py-8 text-center text-[13px] text-zinc-600">
            Nothing matches that filter.
          </p>
        )}
      </div>
    </aside>
  )
}

function isEnabled(options: ObfuscatorOptions, spec: TransformSpec): boolean {
  const entry = options.transforms?.[spec.name]
  return entry !== undefined && entry !== false
}

function FilterInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-600">
        <SearchIcon />
      </span>
      <input
        type="text"
        value={value}
        aria-label="Filter transforms"
        placeholder="Filter transforms"
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="h-8 w-full rounded-lg border border-line bg-zinc-900 pr-8 pl-8 text-[13px] text-zinc-200 transition-colors outline-none placeholder:text-zinc-600 hover:border-zinc-700 focus:border-blue-600"
      />
      {value !== '' && (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => {
            onChange('')
          }}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

function GroupHeading({
  title,
  enabled,
  total,
}: {
  title: string
  enabled?: number
  total?: number
}) {
  return (
    <h3 className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-chrome px-2 pt-4 pb-1.5 text-[12px] font-medium text-zinc-500">
      <span>{title}</span>
      {total !== undefined && (
        <span className="tabular-nums text-zinc-600">
          {enabled}/{total}
        </span>
      )}
    </h3>
  )
}

function TransformToggle({
  spec,
  checked,
  onChange,
}: {
  spec: TransformSpec
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = `transform-${spec.name}`
  return (
    <div className="group flex items-center gap-1 rounded-lg pr-1.5 transition-colors hover:bg-zinc-800/60">
      <label
        htmlFor={id}
        title={spec.description}
        className="min-w-0 flex-1 cursor-pointer truncate py-1.5 pl-2 font-mono text-[12.5px] text-zinc-300 select-none"
      >
        {spec.name}
      </label>
      <a
        href={transformDocsUrl(spec.name)}
        target="_blank"
        rel="noreferrer"
        title={`Read the ${spec.name} reference`}
        aria-label={`Read the ${spec.name} reference`}
        className="rounded p-1 text-zinc-600 opacity-0 transition-opacity outline-offset-2 group-hover:opacity-100 hover:text-zinc-200 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <ExternalLinkIcon />
      </a>
      <Switch id={id} checked={checked} onChange={onChange} />
    </div>
  )
}

function ToggleRow({
  id,
  label,
  title,
  checked,
  onChange,
}: {
  id: string
  label: string
  title: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <label
        htmlFor={id}
        title={title}
        className="cursor-pointer truncate text-[13px] text-zinc-400 select-none"
      >
        {label}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} />
    </div>
  )
}

function Details({ children }: { children: ReactNode }) {
  // The right padding matches `TransformToggle` so nested controls line up.
  return (
    <div className="mt-1 mb-2 ml-3 space-y-1 border-l border-zinc-700/70 pr-1.5 pl-3">
      {children}
    </div>
  )
}

function keepQuotedPatch(choice: string): boolean | 'strict' | undefined {
  if (choice === 'true') {
    return true
  }
  if (choice === 'strict') {
    return 'strict'
  }
  return undefined
}

function MangleDetails({
  mangle,
  override,
  onOverride,
  onPatch,
}: {
  mangle: ManglePropertiesOptions
  override: StringGeneratorModeOption | undefined
  onOverride: (choice: string) => void
  onPatch: (patch: PatchOf<ManglePropertiesOptions>) => void
}) {
  return (
    <Details>
      {MANGLE_FLAGS.map((flag) => (
        <ToggleRow
          key={flag.key}
          id={`mangle-${flag.key}`}
          label={flag.key}
          title={flag.description}
          checked={mangle[flag.key] === true}
          onChange={(checked) => {
            switch (flag.key satisfies MangleFlagKey) {
              case 'builtins':
                onPatch({ builtins: checked || undefined })
                break
              case 'undeclared':
                onPatch({ undeclared: checked || undefined })
                break
              case 'onlyAnnotated':
                onPatch({ onlyAnnotated: checked || undefined })
                break
              case 'onlyCache':
                onPatch({ onlyCache: checked || undefined })
                break
            }
          }}
        />
      ))}
      <SelectField
        label="keepQuoted"
        title="Preserve quoted occurrences of a name"
        options={KEEP_QUOTED_CHOICES}
        value={mangle.keepQuoted === undefined ? 'false' : String(mangle.keepQuoted)}
        onChange={(choice) => {
          onPatch({ keepQuoted: keepQuotedPatch(choice) })
        }}
      />
      <CommitTextField
        label="regex"
        title="Only mangle names matching this pattern"
        placeholder="^_"
        value={mangle.regex instanceof RegExp ? mangle.regex.source : (mangle.regex ?? '')}
        onCommit={(text) => {
          onPatch({ regex: text.length > 0 ? text : undefined })
        }}
      />
      <CommitTextField
        label="reserved"
        title="Names to leave alone, comma separated"
        placeholder="id, url"
        value={(mangle.reserved ?? []).join(', ')}
        onCommit={(text) => {
          const names = text
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
          onPatch({ reserved: names.length > 0 ? names : undefined })
        }}
      />
      <SelectField
        label="Name style"
        title="Override the global generator style for the mangled names"
        options={modeChoices(override, true)}
        value={displayMode(override)}
        onChange={onOverride}
      />
      <Caveat>
        Boundary-dependent. Code outside this input that reads the same property names breaks.
      </Caveat>
    </Details>
  )
}

function PackDetails({
  pack,
  override,
  onOverride,
  onPatch,
}: {
  pack: PackOptions
  override: StringGeneratorModeOption | undefined
  onOverride: (choice: string) => void
  onPatch: (patch: PatchOf<PackOptions>) => void
}) {
  return (
    <Details>
      <ToggleRow
        id="pack-escapeStrict"
        label="escapeStrict"
        title="Skip the strict-mode directive so the packed body runs sloppy"
        checked={pack.escapeStrict === true}
        onChange={(checked) => {
          onPatch({ escapeStrict: checked || undefined })
        }}
      />
      {pack.escapeStrict === true && (
        <Caveat>Behavior changes. The packed body runs sloppy even for strict sources.</Caveat>
      )}
      <SelectField
        label="Name style"
        title="Override the global generator style for the names pack introduces"
        options={modeChoices(override, true)}
        value={displayMode(override)}
        onChange={onOverride}
      />
    </Details>
  )
}

function Caveat({ children }: { children: string }) {
  return <p className="pt-1 text-[12px] leading-relaxed text-amber-500/90">{children}</p>
}
