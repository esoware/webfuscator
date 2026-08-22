import { Switch as BaseSwitch } from '@base-ui/react/switch'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export function Switch(props: SwitchProps) {
  return (
    <BaseSwitch.Root
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-neutral-700 p-0.5 transition-colors hover:bg-neutral-600 data-checked:bg-accent data-checked:hover:bg-accent/90"
      {...props}
    >
      <BaseSwitch.Thumb className="size-4 rounded-full bg-white transition-transform data-checked:translate-x-4" />
    </BaseSwitch.Root>
  )
}
