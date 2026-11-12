/**
 * The two marks the mock carried as an inline <defs> sprite, as components.
 * They inherit `currentColor` and the ported CSS sizes them per context
 * (.button svg, .title-star>svg, .mini-symbol>svg, .world-nav svg).
 */

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M5 19 19 5M5 5h14v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d="M24 3v42M3 24h42M9 9l30 30M9 39 39 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
