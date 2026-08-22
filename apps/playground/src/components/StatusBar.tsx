import { RUN_SHORTCUT_KEYS } from '../lib/shortcut'
import { Hint } from './Tooltip'

interface StatusBarProps {
  warnings: readonly string[]
  onShowWarnings: () => void
}

export function StatusBar({ warnings, onShowWarnings }: StatusBarProps) {
  return (
    <footer className="flex h-10 shrink-0 items-center justify-end gap-4 px-4 text-xs text-fg-subtle">
      {warnings.length > 0 && (
        <Hint
          side="top"
          content={
            <ul className="space-y-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
        >
          {/* The tooltip summarizes. Pressing this opens the config tab, where
              the same warnings already print in full under the editor. */}
          <button
            type="button"
            onClick={onShowWarnings}
            className="rounded-md px-1.5 py-0.5 text-warning transition-colors hover:bg-tint"
          >
            {warnings.length} config warning{warnings.length === 1 ? '' : 's'}
          </button>
        </Hint>
      )}

      <span className="hidden items-center gap-1 sm:flex">
        {RUN_SHORTCUT_KEYS.map((key) => (
          <kbd key={key} className="rounded-md bg-fill px-1.5 py-0.5 font-sans text-fg-muted">
            {key}
          </kbd>
        ))}
        <span className="ml-1">to obfuscate</span>
      </span>
    </footer>
  )
}
