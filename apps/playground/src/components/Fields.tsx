import { useState } from 'react'
import type { ReactNode } from 'react'

const CONTROL_CLASSES =
  'h-8 rounded-lg border border-line bg-zinc-900 px-2 text-[13px] text-zinc-200 transition-colors outline-none hover:border-zinc-700 focus:border-blue-600'

interface SelectOption {
  value: string
  label: string
}

function FieldRow({
  label,
  title,
  control,
}: {
  label: string
  title?: string | undefined
  control: ReactNode
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-0.5" title={title}>
      <span className="truncate text-[13px] text-zinc-400">{label}</span>
      {control}
    </label>
  )
}

export function SelectField({
  label,
  title,
  options,
  value,
  onChange,
}: {
  label: string
  title?: string
  options: readonly SelectOption[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <FieldRow
      label={label}
      title={title}
      control={
        <select
          className={`${CONTROL_CLASSES} w-36 shrink-0 cursor-pointer`}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      }
    />
  )
}

export function NumberField({
  label,
  title,
  value,
  min,
  onChange,
}: {
  label: string
  title?: string
  value: number
  min?: number
  onChange: (value: number) => void
}) {
  return (
    <FieldRow
      label={label}
      title={title}
      control={
        <input
          type="number"
          min={min}
          className={`${CONTROL_CLASSES} w-36 shrink-0 tabular-nums`}
          value={value}
          onChange={(event) => {
            const next = event.target.valueAsNumber
            if (Number.isFinite(next)) {
              onChange(next)
            }
          }}
        />
      }
    />
  )
}

export function CommitTextField({
  label,
  title,
  placeholder,
  value,
  onCommit,
}: {
  label: string
  title?: string
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
    <FieldRow
      label={label}
      title={title}
      control={
        <input
          type="text"
          className={`${CONTROL_CLASSES} w-36 shrink-0 font-mono text-[12px] placeholder:text-zinc-600`}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onBlur={() => {
            if (draft !== value) {
              onCommit(draft)
            }
          }}
        />
      }
    />
  )
}
