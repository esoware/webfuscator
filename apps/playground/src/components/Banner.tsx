/** Babel and the config parser format their own messages, so keep the line breaks. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="max-h-32 shrink-0 overflow-y-auto border-t border-danger-line bg-danger-fill px-3.5 py-2 font-mono text-xs whitespace-pre-wrap text-danger"
    >
      {message}
    </div>
  )
}
