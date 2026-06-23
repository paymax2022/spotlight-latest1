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

/** "28 Jun 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Sat 28 Jun · 5:00 PM". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Days until a date; negative when overdue. */
export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** Human due label: "Due in 5 days" / "Overdue by 12 days" / "Due today". */
export function dueLabel(iso: string): string {
  const d = daysUntil(iso);
  if (d === 0) return 'Due today';
  if (d > 0) return d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
  const od = Math.abs(d);
  return od === 1 ? 'Overdue by 1 day' : `Overdue by ${od} days`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
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
