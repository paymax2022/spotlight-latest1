// ── Association — Formatters ──────────────────────────────────────────────────
// All money is in kobo (integer minor units). Display helpers convert to ₦.

/** ₦ from kobo, grouped thousands. e.g. 2_000_000 → "₦20,000". */
export function formatNaira(kobo: number, opts?: { decimals?: boolean }): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

/** Compact ₦ for cards: 25_000_000 → "₦250K". */
export function formatNairaCompact(kobo: number): string {
  const naira = kobo / 100;
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(naira % 1_000_000 === 0 ? 0 : 1)}M`;
  if (naira >= 1_000) return `₦${(naira / 1_000).toFixed(naira % 1_000 === 0 ? 0 : 1)}K`;
  return `₦${naira.toLocaleString('en-NG')}`;
}

/** Compact member count: 42180 → "42.2k members". */
export function formatCount(n: number, noun: string): string {
  const label = n === 1 ? noun.replace(/s$/, '') : noun;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k ${label}`;
  return `${n.toLocaleString('en-NG')} ${label}`;
}

/**
 * Naira text → integer kobo. Returns null for anything that is not a clean,
 * non-negative amount with at most two decimal places.
 *
 * Deliberately parsed digit-by-digit rather than `parseFloat(x) * 100`: the
 * float route turns ₦1,234.35 into 123434.99999999999 and then a wrong
 * integer, which is a real money bug the moment it is rounded the other way.
 */
export function nairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const kobo = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(kobo) ? kobo : null;
}

/**
 * Parse a server timestamp defensively. Returns null instead of an Invalid Date
 * or the epoch.
 *
 * Two shapes reach the client and neither is guaranteed to be present:
 *   • RFC3339 from the JSON DTOs ("2026-06-28T17:00:00Z")
 *   • Postgres `::text` from the admin listings ("2026-06-28 17:00:00+00")
 *
 * `new Date(null)` is 1 Jan 1970, not an error — which is exactly how the
 * membership card came to read "Valid thru 1 Jan 1970" for a card with no
 * expiry, and how a now-nullable invoice `dueDate` would render as an epoch
 * date. Every formatter below goes through here, so a missing date can never be
 * displayed as a real one.
 */
export function parseDateSafe(value?: string | null): Date | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  // Postgres `timestamptz::text` uses a space separator and a 2-digit offset;
  // normalise both so the platform Date parser accepts it.
  const normalised = /^\d{4}-\d{2}-\d{2} /.test(raw)
    ? raw.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
    : raw;
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "28 Jun 2026", or `fallback` when the date is missing or unparseable. */
export function formatDate(iso?: string | null, fallback = '—'): string {
  const d = parseDateSafe(iso);
  if (!d) return fallback;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Sat 28 Jun · 5:00 PM", or `fallback` when the date is missing/unparseable. */
export function formatDateTime(iso?: string | null, fallback = '—'): string {
  const d = parseDateSafe(iso);
  if (!d) return fallback;
  const date = d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Days until a date; negative when overdue. Null when there is no usable date. */
export function daysUntil(iso?: string | null): number | null {
  const d = parseDateSafe(iso);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/**
 * Human due label: "Due in 5 days" / "Overdue by 12 days" / "Due today".
 * An invoice with no due date says so, rather than claiming it is twenty
 * thousand days overdue.
 */
export function dueLabel(iso?: string | null, fallback = 'No due date'): string {
  const d = daysUntil(iso);
  if (d === null) return fallback;
  if (d === 0) return 'Due today';
  if (d > 0) return d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
  const od = Math.abs(d);
  return od === 1 ? 'Overdue by 1 day' : `Overdue by ${od} days`;
}

export function relativeTime(iso?: string | null, fallback = '—'): string {
  const parsed = parseDateSafe(iso);
  if (!parsed) return fallback;
  const diff = Date.now() - parsed.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** Initials from a full name, max 2 letters. "Dr. Chidinma Okeke" → "CO". */
export function initials(name: string): string {
  const parts = name.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Engr\.?|Prof\.?)\s+/i, '').trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
