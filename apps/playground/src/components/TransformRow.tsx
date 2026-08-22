import { Collapsible } from '@base-ui/react/collapsible'
import { Field } from '@base-ui/react/field'
import type { ReactNode } from 'react'
import type { ManglePropertiesOptions, ObfuscatorOptions, PackOptions } from 'webfuscator'

import { ExternalLinkIcon } from '../lib/icons'
import { transformDocsUrl } from '../lib/links'
import { displayMode, modeChoices } from '../lib/modes'
import { KEEP_QUOTED_CHOICES, MANGLE_FLAGS, isStringGeneratorMode } from '../lib/schema'
import type { TransformSpec } from '../lib/schema'
import {
  editTransformEntry,
  entryMode,
  entryObject,
  isEntryEnabled,
  patchTransformEntry,
} from '../lib/transformEntry'
import type { ModeOverride, PatchOf } from '../lib/transformEntry'
import { CommitTextField, SelectField, SwitchField } from './Fields'
import { Switch } from './Switch'
import { Hint } from './Tooltip'

type MangleFlagKey = (typeof MANGLE_FLAGS)[number]['key']

function flagPatch(key: MangleFlagKey, checked: boolean): PatchOf<ManglePropertiesOptions> {
  return { [key]: checked || undefined }
}

interface TransformRowProps {
  spec: TransformSpec
  options: ObfuscatorOptions
  onChange: (next: ObfuscatorOptions) => void
}

export function TransformRow({ spec, options, onChange }: TransformRowProps) {
  const entry = options.transforms?.[spec.name]
  const enabled = isEntryEnabled(entry)
  const override = entryMode(entry)

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
    <div>
      <Field.Root className="group flex items-center gap-1 rounded-xl py-1 pr-1.5 pl-5 transition-colors hover:bg-tint">
        <Hint content={spec.description}>
          <Field.Label className="min-w-0 flex-1 text-sm text-fg-muted transition-colors select-none group-hover:text-fg">
            {spec.name}
          </Field.Label>
        </Hint>

        <Field.Description className="sr-only">{spec.description}</Field.Description>

        <a
          href={transformDocsUrl(spec.name)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open the ${spec.name} reference`}
          className="rounded-md p-1 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
        >
          <ExternalLinkIcon size={12} aria-hidden />
        </a>

        <Switch
          checked={enabled}
          onCheckedChange={(checked) => {
            onChange(editTransformEntry(options, spec.name, checked ? true : undefined))
          }}
        />
      </Field.Root>

      {spec.kind !== 'boolean' && (
        <Details open={enabled} name={spec.name}>
          {spec.kind === 'mangle' && (
            <MangleDetails
              mangle={entryObject<ManglePropertiesOptions>(entry)}
              onPatch={patchDetails}
            />
          )}

          {spec.kind === 'pack' && (
            <PackDetails pack={entryObject<PackOptions>(entry)} onPatch={patchDetails} />
          )}

          {/* Every kind with a disclosure has this override, so it renders here
              rather than inside each one. */}
          <SelectField
            label="Name style"
            hint="Override the global generator style for this transform"
            options={modeChoices(override, true)}
            value={displayMode(override)}
            onChange={setOverride}
          />
        </Details>
      )}
    </div>
  )
}

function Details({ open, name, children }: { open: boolean; name: string; children: ReactNode }) {
  return (
    <Collapsible.Root open={open}>
      <Collapsible.Panel
        aria-label={`${name} settings`}
        className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-300 ease-in-out data-ending-style:h-0 data-starting-style:h-0"
      >
        <div className="mt-1 mr-1.5 mb-1.5 ml-5 rounded-lg bg-tint px-2.5 py-1.5">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
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
  onPatch,
}: {
  mangle: ManglePropertiesOptions
  onPatch: (patch: PatchOf<ManglePropertiesOptions>) => void
}) {
  return (
    <>
      {MANGLE_FLAGS.map((flag) => (
        <SwitchField
          key={flag.key}
          label={flag.key}
          hint={flag.description}
          checked={mangle[flag.key] === true}
          onChange={(checked) => {
            onPatch(flagPatch(flag.key, checked))
          }}
        />
      ))}
      <SelectField
        label="keepQuoted"
        hint="Preserve quoted occurrences of a name"
        options={KEEP_QUOTED_CHOICES}
        value={mangle.keepQuoted === undefined ? 'false' : String(mangle.keepQuoted)}
        onChange={(choice) => {
          onPatch({ keepQuoted: keepQuotedPatch(choice) })
        }}
      />
      <CommitTextField
        label="regex"
        hint="Only mangle names matching this pattern"
        placeholder="^_"
        value={mangle.regex instanceof RegExp ? mangle.regex.source : (mangle.regex ?? '')}
        onCommit={(text) => {
          onPatch({ regex: text.length > 0 ? text : undefined })
        }}
      />
      <CommitTextField
        label="reserved"
        hint="Names to leave alone, comma separated"
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
      <Caveat>
        Boundary-dependent. Code outside this input that reads the same property names breaks.
      </Caveat>
    </>
  )
}

function PackDetails({
  pack,
  onPatch,
}: {
  pack: PackOptions
  onPatch: (patch: PatchOf<PackOptions>) => void
}) {
  return (
    <>
      <SwitchField
        label="escapeStrict"
        hint="Skip the strict-mode directive so the packed body runs sloppy"
        checked={pack.escapeStrict === true}
        onChange={(checked) => {
          onPatch({ escapeStrict: checked || undefined })
        }}
      />
      {pack.escapeStrict === true && (
        <Caveat>Behavior changes. The packed body runs sloppy even for strict sources.</Caveat>
      )}
    </>
  )
}

/** The docs' warning callout at the size of a sidebar row. */
function Caveat({ children }: { children: string }) {
  return (
    <p className="my-1.5 rounded-md border border-warning-line bg-warning-fill px-2.5 py-1.5 text-xs text-warning">
      {children}
    </p>
  )
}
