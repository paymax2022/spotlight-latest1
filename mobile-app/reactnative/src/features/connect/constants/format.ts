// Connect money formatting. ALL amounts are integers in minor units (kobo).
// Never do floating-point math on money; this only formats for display.

export function formatKobo(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  const naira = Math.trunc(kobo / 100);
  const formatted = naira.toLocaleString('en-NG');
  return `₦${formatted}`;
}

// Percentage of a daily limit remaining (0..1), guarding the unlimited (null) case.
export function remainingFraction(
  remainingKobo: number | null,
  dailyLimitKobo: number | null,
): number {
  if (dailyLimitKobo == null || remainingKobo == null || dailyLimitKobo <= 0) return 1;
  return Math.max(0, Math.min(1, remainingKobo / dailyLimitKobo));
}
