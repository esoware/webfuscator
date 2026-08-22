import { Field } from '@base-ui/react/field'

import { SpinnerIcon } from '../lib/icons'
import { DOCS_URL, GITHUB_URL, NPM_URL } from '../lib/links'
import { RUN_SHORTCUT_TITLE } from '../lib/shortcut'
import { Button } from './Button'
import { Switch } from './Switch'
import { Hint } from './Tooltip'
import { Wordmark } from './Wordmark'

interface HeaderProps {
  runOnChange: boolean
  onRunOnChangeToggle: (runOnChange: boolean) => void
  onRun: () => void
  stale: boolean
  busy: boolean
}

export function Header({ runOnChange, onRunOnChangeToggle, onRun, stale, busy }: HeaderProps) {
  return (
    // 64px tall, the same as the docs navbar. No rule under it. The window below
    // already ends the header, and a second edge cuts across its corners.
    <header className="flex h-16 shrink-0 items-center justify-between gap-6 px-4">
      <h1 className="flex">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center rounded-md text-neutral-50 transition-colors hover:text-white"
        >
          <Wordmark />
          <span className="sr-only">webfuscator playground</span>
        </a>
      </h1>

      <div className="flex items-center gap-5">
        <nav aria-label="Project links" className="hidden items-center gap-6 sm:flex">
          <NavLink href={DOCS_URL}>Docs</NavLink>
          <NavLink href={GITHUB_URL}>GitHub</NavLink>
          <NavLink href={NPM_URL}>npm</NavLink>
        </nav>

        <Field.Root className="hidden items-center gap-2.5 md:flex">
          <Hint content="Obfuscate again on every edit, cancelling whatever run is still going">
            <Field.Label className="text-sm text-fg-muted select-none">Run on change</Field.Label>
          </Hint>
          <Switch checked={runOnChange} onCheckedChange={onRunOnChangeToggle} />
        </Field.Root>

        <Hint content={RUN_SHORTCUT_TITLE}>
          {/* Wide enough for the label plus the spinner, so starting a run does
              not resize the button under the pointer. */}
          <Button variant="primary" onClick={onRun} aria-busy={busy} className="min-w-32">
            {busy && <SpinnerIcon size={14} stroke={2.5} aria-hidden className="animate-spin" />}
            Obfuscate
            {!busy && stale && (
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-on-accent/80 transition-opacity"
              />
            )}
          </Button>
        </Hint>
      </div>
    </header>
  )
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-md text-sm font-medium text-fg-muted transition-colors hover:text-fg"
    >
      {children}
    </a>
  )
}
