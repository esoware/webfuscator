interface SwitchProps {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/**
 * A real checkbox under a painted track, so a sibling `<label htmlFor>` gives
 * the row its accessible name and its whole width as a hit target.
 */
export function Switch({ id, checked, onChange }: SwitchProps) {
  return (
    <span className="relative inline-flex h-[18px] w-8 shrink-0 items-center">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
        className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-blue-500"
      />
      <span className="pointer-events-none absolute inset-0 rounded-full bg-zinc-700 transition-colors peer-checked:bg-blue-600 peer-hover:bg-zinc-600 peer-checked:peer-hover:bg-blue-500" />
      <span className="pointer-events-none absolute left-[3px] h-3 w-3 rounded-full bg-white transition-transform peer-checked:translate-x-3.5" />
    </span>
  )
}
