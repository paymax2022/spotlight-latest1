/**
 * Tuition rows are stored in NAIRA (`price_ngn`), unlike the rest of the
 * platform's money, which is kobo — so the shared `formatNaira` helpers, which
 * all divide by 100, would print every academy price a hundred times too small.
 */
export function formatNaira(naira: number | null | undefined): string {
  const value = Number(naira);
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

/** `YYYY-MM-DD` as a local calendar day, or null when the column has no readable date. */
function parseProgrammeDate(iso: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD` → `22 Nov 2026`, parsed as a local calendar day, not UTC. */
export function formatProgrammeDate(iso: string | null | undefined): string | null {
  const date = parseProgrammeDate(iso);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/**
 * Where an intake sits on the calendar, in words a visitor can rely on.
 * `academy_batches.status` is typed by an admin and can lag behind the dates,
 * so a card that prints a start date already in the past must not call it
 * "upcoming" — the start date decides.
 */
export function intakePhase(
  batch: { start_date?: string | null; status?: string | null },
  today = new Date(),
): string {
  const start = parseProgrammeDate(batch.start_date);
  if (!start) {
    return String(batch.status ?? '').toLowerCase() === 'ongoing' ? 'Running now' : 'Upcoming intake';
  }

  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  return start > startOfToday ? 'Upcoming intake' : 'Under way';
}

export const SCHEDULE_LABELS: Record<string, string> = {
  weekdays: 'Week days — Monday to Friday',
  weekends: 'Weekend — Saturday & Sunday',
  accelerated: 'Full time — accelerated',
  full_time: 'Full time',
};

export function scheduleLabel(schedule: string | null | undefined): string | null {
  if (!schedule) return null;
  return SCHEDULE_LABELS[schedule] ?? String(schedule)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
