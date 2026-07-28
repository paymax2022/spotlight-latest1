/**
 * Shared money formatting for the wallet / transfers surfaces.
 *
 * Amounts are always integers in minor units (kobo). There are ~25 ad-hoc
 * `₦${kobo/100}` formatters scattered across the app; new screens should use
 * this helper so currency rendering stays consistent. We intentionally do NOT
 * rewrite the existing duplicates here.
 */

/** Format a kobo (minor-unit) integer as a Naira string, e.g. 150000 → "₦1,500.00". */
export function formatNaira(kobo: number, opts?: { decimals?: boolean }): string {
  const showDecimals = opts?.decimals ?? true;
  const naira = (Number.isFinite(kobo) ? kobo : 0) / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  })}`;
}

/** Parse a user-entered naira amount string ("1,500.50") into kobo (150050). */
export function nairaStringToKobo(value: string): number {
  const clean = Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(clean)) return 0;
  return Math.round(clean * 100);
}
