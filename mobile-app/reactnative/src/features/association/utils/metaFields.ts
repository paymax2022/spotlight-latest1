// ── Association — Safe readers for the admin listing `meta` bag ───────────────
//
// `AdminContentRow.meta` is whatever `jsonb_build_object` the server chose for
// that content type, so it is `Record<string, unknown>` by construction. The
// edit forms seed their fields from it; reading it with casts would let a null
// column (or a renamed key) become the string "null" in an input box, or crash
// a `.map()` on a missing array.

/** A trimmed string, or null when the value is absent/blank/not a string. */
export function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** A boolean; anything else is false. */
export function bool(v: unknown): boolean {
  return v === true;
}

/**
 * A finite number, or null. Accepts the numeric strings Postgres `jsonb` can
 * produce for bigint columns — `feeKobo` must survive that round trip as an
 * exact integer, never a parsed float.
 */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** An integer amount in minor units; 0 when absent. Never a float. */
export function kobo(v: unknown): number {
  const n = num(v);
  return n === null || !Number.isInteger(n) ? 0 : n;
}

/** A list of non-empty strings; [] for anything else. */
export function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
}

/** A value from a known union, or the given fallback. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
