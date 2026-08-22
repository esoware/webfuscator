/**
 * Inline rather than an `<img>` so the mark renders in the Inter the page loads.
 * An SVG behind `<img>` gets an isolated document with no access to page fonts,
 * which drops this wordmark to the Arial fallback for anyone without Inter
 * installed locally.
 */
export function Wordmark() {
  return (
    <svg
      width="98"
      height="24"
      viewBox="0 0 98 24"
      fill="none"
      aria-hidden="true"
      className="h-7 w-auto"
    >
      <text
        x="0"
        y="18"
        fill="currentColor"
        fontFamily="inherit"
        fontSize="18"
        fontWeight="700"
        textLength="98"
        lengthAdjust="spacing"
      >
        webfuscator
      </text>
    </svg>
  )
}
