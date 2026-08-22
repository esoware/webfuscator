import { DOCS_URL, GITHUB_URL, NPM_URL } from '../lib/links'
import { RUN_SHORTCUT_TITLE } from '../lib/shortcut'
import { Button } from './Button'
import { Switch } from './Switch'

interface HeaderProps {
  runOnChange: boolean
  onRunOnChangeToggle: (runOnChange: boolean) => void
  onRun: () => void
  stale: boolean
}

export function Header({ runOnChange, onRunOnChangeToggle, onRun, stale }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-line bg-chrome px-4">
      <div className="flex items-center gap-3">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center rounded-sm outline-offset-4 focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          <img
            src={`${import.meta.env.BASE_URL}wordmark.svg`}
            alt="webfuscator"
            width={98}
            height={24}
            className="h-6 w-auto"
          />
        </a>
        <span className="h-4 w-px bg-zinc-700" />
        <span className="text-[14px] text-zinc-500">Playground</span>
      </div>

      <div className="flex items-center gap-4">
        <nav className="hidden items-center gap-4 sm:flex">
          <NavLink href={DOCS_URL}>Docs</NavLink>
          <NavLink href={GITHUB_URL}>GitHub</NavLink>
          <NavLink href={NPM_URL}>npm</NavLink>
        </nav>

        <span className="hidden h-5 w-px bg-zinc-800 sm:block" />

        <div className="hidden items-center gap-2 md:flex">
          <label
            htmlFor="run-on-change"
            className="cursor-pointer text-[13px] text-zinc-400 select-none"
            title="Obfuscate again on every edit, cancelling whatever run is still going"
          >
            Run on change
          </label>
          <Switch id="run-on-change" checked={runOnChange} onChange={onRunOnChangeToggle} />
        </div>

        <Button
          variant="primary"
          onClick={onRun}
          title={RUN_SHORTCUT_TITLE}
          className={stale ? 'ring-2 ring-blue-500/40' : ''}
        >
          Obfuscate
        </Button>
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
      className="rounded-sm text-[13px] text-zinc-400 transition-colors outline-offset-4 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      {children}
    </a>
  )
}
