// Referral money formatting. ALL amounts are integers in minor units (kobo).
// Never do floating-point math on money; this only formats for display.

export function formatNaira(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  const naira = Math.trunc(kobo / 100);
  return `₦${naira.toLocaleString('en-NG')}`;
}

// Full naira + kobo (e.g. ₦1,234.50) for statements where the sub-naira part matters.
export function formatNairaPrecise(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Relative "time ago" for notification/attribution timelines.
export function relativeTime(iso: string | number | Date): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(then)) return '';
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

// Countdown for the grace window (§7A.3). Returns null once expired.
export function formatCountdown(expiresAtIso: string | null | undefined): string | null {
  if (!expiresAtIso) return null;
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const remH = h % 24;
    return `${d}d ${remH}h`;
  }
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}
