import { RUN_SHORTCUT_KEYS } from '../lib/shortcut'

interface StatusBarProps {
  warnings: readonly string[]
}

export function StatusBar({ warnings }: StatusBarProps) {
  return (
    <footer className="flex h-9 shrink-0 items-center justify-end gap-4 border-t border-line bg-chrome px-4 text-[12px] text-zinc-500">
      {warnings.length > 0 && (
        <span className="text-amber-400/90" title={warnings.join('\n')}>
          {warnings.length} config warning{warnings.length === 1 ? '' : 's'}
        </span>
      )}
      <span className="hidden items-center gap-1.5 sm:flex">
        {RUN_SHORTCUT_KEYS.map((key) => (
          <kbd
            key={key}
            className="rounded border border-line bg-zinc-900 px-1.5 py-0.5 font-sans text-[11px] text-zinc-400"
          >
            {key}
          </kbd>
        ))}
        <span>to obfuscate</span>
      </span>
    </footer>
  )
}
