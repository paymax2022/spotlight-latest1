// Date and time rules for scheduling a trip. Pure: no React Native or '@/'
// imports, so it runs under node:test.

/** Trips must be booked at least this far ahead, so a driver can be assigned. */
export const MIN_LEAD_MINUTES = 30;
/** How far ahead a trip may be booked. */
export const MAX_LEAD_DAYS = 30;

const pad = (n: number) => String(n).padStart(2, '0');

/** The device's calendar date of an instant, as YYYY-MM-DD. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The device's clock time of an instant, as HH:MM. */
export function localTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Combine a local date (YYYY-MM-DD) and clock time (HH:MM) into an ISO instant.
 * Returns '' until both parts are set, so a half-filled picker never produces a time.
 */
export function combineLocal(date: string | undefined, time: string | undefined): string {
  if (!date || !time) return '';
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return '';
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Date() silently rolls 2026-02-31 over to March; refuse that rather than book it.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return dt.toISOString();
}

/**
 * Why a scheduled time cannot be booked, or null when it can. Messages are shown
 * to the rider, so they say what to change.
 */
export function scheduleTimeError(iso: string, now: Date = new Date()): string | null {
  if (!iso) return 'Choose a date and time for your trip';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Choose a valid date and time';
  const leadMs = t - now.getTime();
  if (leadMs < MIN_LEAD_MINUTES * 60_000) {
    return `Choose a time at least ${MIN_LEAD_MINUTES} minutes from now`;
  }
  if (leadMs > MAX_LEAD_DAYS * 86_400_000) {
    return `Trips can be booked up to ${MAX_LEAD_DAYS} days ahead`;
  }
  return null;
}

/** The default pickup time: the next full hour, at least the minimum lead time away. */
export function defaultScheduleTime(now: Date = new Date()): string {
  const d = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
  d.setMinutes(0, 0, 0);
  if (d.getTime() - now.getTime() < MIN_LEAD_MINUTES * 60_000) d.setHours(d.getHours() + 1);
  return d.toISOString();
}
