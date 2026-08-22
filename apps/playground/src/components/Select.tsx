import { Select as BaseSelect } from '@base-ui/react/select'

import { CheckIcon, ChevronUpDownIcon } from '../lib/icons'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  options: readonly SelectOption[]
  onValueChange: (value: string) => void
}

export function Select({ value, options, onValueChange }: SelectProps) {
  return (
    <BaseSelect.Root
      items={options}
      value={value}
      onValueChange={(next) => {
        // Only a `null` default or an explicit clear produces null, and no select
        // here offers either.
        if (next !== null) {
          onValueChange(next)
        }
      }}
    >
      <BaseSelect.Trigger className="flex h-8 w-36 shrink-0 items-center justify-between gap-2 rounded-lg bg-fill pr-1.5 pl-2.5 text-sm text-fg transition-colors select-none hover:bg-fill-hover hover:text-fg-strong active:bg-fill-active">
        <BaseSelect.Value className="truncate" />
        <BaseSelect.Icon className="text-fg-subtle">
          <ChevronUpDownIcon size={14} aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="z-50 outline-none"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-xl bg-overlay p-1 ring-1 ring-line-strong shadow-lg shadow-black/40 outline-none transition-[transform,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  className="grid grid-cols-[1rem_1fr] items-center gap-1.5 rounded-lg py-1 pr-3 pl-1.5 text-sm text-fg-muted outline-none select-none data-highlighted:bg-fill-hover data-highlighted:text-fg-strong"
                >
                  <BaseSelect.ItemIndicator className="col-start-1 text-accent-soft">
                    <CheckIcon size={14} aria-hidden />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="col-start-2 truncate">
                    {option.label}
                  </BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
