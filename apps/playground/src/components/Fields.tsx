import { Field } from '@base-ui/react/field'
import { Input } from '@base-ui/react/input'
import { NumberField } from '@base-ui/react/number-field'
import { useState } from 'react'

import { MinusIcon, PlusIcon } from '../lib/icons'
import { Select } from './Select'
import type { SelectOption } from './Select'
import { Switch } from './Switch'
import { Hint } from './Tooltip'

/* Every row here sits inside a transform's disclosure, one level under the
   toolbar, so its controls take the nested size and radius. */

interface LabelProps {
  text: string
  hint: string
  nativeLabel?: boolean
}

function Label({ text, hint, nativeLabel = true }: LabelProps) {
  const label = nativeLabel ? (
    <Field.Label className="min-w-0 flex-1 truncate text-sm text-fg-muted select-none">
      {text}
    </Field.Label>
  ) : (
    // A `<label>` over a button control hands the button its hover and its clicks.
    <Field.Label
      className="min-w-0 flex-1 truncate text-sm text-fg-muted select-none"
      nativeLabel={false}
      render={<span />}
    >
      {text}
    </Field.Label>
  )
  return (
    <>
      <Hint content={hint}>{label}</Hint>
      {/* A label never takes focus, so the tooltip alone puts the hint out of
          reach of the keyboard. Field points the control's `aria-describedby`
          at this copy instead. */}
      <Field.Description className="sr-only">{hint}</Field.Description>
    </>
  )
}

export function SwitchField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Field.Root className="flex items-center justify-between gap-3 py-0.5">
      <Label text={label} hint={hint} />
      <Switch checked={checked} onCheckedChange={onChange} />
    </Field.Root>
  )
}

export function SelectField({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string
  hint: string
  options: readonly SelectOption[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field.Root className="flex items-center justify-between gap-3 py-0.5">
      <Label text={label} hint={hint} nativeLabel={false} />
      <Select options={options} value={value} onValueChange={onChange} />
    </Field.Root>
  )
}

export function NumberSpinner({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  onChange: (value: number) => void
}) {
  return (
    <Field.Root className="flex items-center justify-between gap-3 py-0.5">
      <NumberField.Root
        className="contents"
        value={value}
        min={min}
        onValueChange={(next) => {
          onChange(next ?? min)
        }}
      >
        {/* Dragging the label scrubs the value, which beats aiming at the steppers. */}
        <NumberField.ScrubArea className="min-w-0 flex-1 cursor-ew-resize">
          <Label text={label} hint={hint} />
        </NumberField.ScrubArea>
        <NumberField.Group className="flex h-8 w-36 shrink-0 items-center rounded-lg bg-fill transition-colors focus-within:bg-fill-hover">
          <NumberField.Decrement
            className="flex size-8 shrink-0 items-center justify-center rounded-l-lg text-fg-muted transition-colors hover:text-fg-strong data-disabled:opacity-30"
            aria-label="Decrease"
          >
            <MinusIcon size={13} aria-hidden />
          </NumberField.Decrement>
          <NumberField.Input className="h-full min-w-0 flex-1 bg-transparent text-center text-fg tabular-nums outline-none" />
          <NumberField.Increment
            className="flex size-8 shrink-0 items-center justify-center rounded-r-lg text-fg-muted transition-colors hover:text-fg-strong"
            aria-label="Increase"
          >
            <PlusIcon size={13} aria-hidden />
          </NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  )
}

export function CommitTextField({
  label,
  hint,
  placeholder,
  value,
  onCommit,
}: {
  label: string
  hint: string
  placeholder?: string
  value: string
  onCommit: (text: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)

  // Setting state during render is React's documented way to reset on a prop change.
  if (value !== committed) {
    setCommitted(value)
    setDraft(value)
  }

  return (
    <Field.Root className="flex items-center justify-between gap-3 py-0.5">
      <Label text={label} hint={hint} />
      {/* Monospace runs wider per character, so one step down the scale matches
          the apparent size of the sans controls beside it. */}
      <Input
        className="h-8 w-36 shrink-0 rounded-lg bg-fill px-2.5 font-mono text-xs text-fg transition-colors outline-none placeholder:text-fg-faint hover:bg-fill-hover focus:bg-fill-hover"
        placeholder={placeholder}
        value={draft}
        onValueChange={setDraft}
        onBlur={() => {
          if (draft !== value) {
            onCommit(draft)
          }
        }}
      />
    </Field.Root>
  )
}
