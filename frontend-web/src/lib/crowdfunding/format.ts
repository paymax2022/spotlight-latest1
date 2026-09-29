export function formatNaira(kobo: number | null | undefined): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

export function progressPct(raisedKobo: number, goalKobo: number): number {
  if (!goalKobo || goalKobo <= 0) return 0;
  return Math.min(100, Math.round((raisedKobo / goalKobo) * 100));
}

export function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const diff = Date.parse(deadline) - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}
