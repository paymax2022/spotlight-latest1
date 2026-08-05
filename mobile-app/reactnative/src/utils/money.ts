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

/**
 * Hard cap on any single naira amount a user may enter, in whole naira.
 * 9 integer digits → ₦999,999,999.99; keeps kobo (×100) well inside JS's safe
 * integer range and blocks absurd/overflow entries. Server enforces the real
 * per-tier + balance limits; this is the input-layer ceiling.
 */
export const MAX_AMOUNT_NAIRA = 999_999_999;

/**
 * Strictly sanitise a free-typed money string so ONLY a well-formed positive
 * amount can ever reach state. Prevents letters, symbols, signs, exponents,
 * multiple dots, >2 decimal places, leading zeros and over-long values — the
 * client-side guard against malformed/manipulated amount entry.
 *
 * Returns a canonical string (no thousands separators) safe for nairaStringToKobo.
 */
export function sanitizeMoneyInput(raw: string): string {
  if (raw == null) return '';
  // 1. keep only digits and dots (drops '-', '+', 'e', letters, spaces, commas…)
  let s = String(raw).replace(/[^\d.]/g, '');
  if (s === '') return '';
  // 2. collapse to a single decimal point (first one wins)
  const dot = s.indexOf('.');
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  }
  // 3. split integer / decimal parts
  const hasDecimal = s.includes('.');
  let [intPart, decPart = ''] = s.split('.');
  // 4. strip leading zeros in the integer part (keep one significant digit)
  intPart = intPart.replace(/^0+(?=\d)/, '');
  // 5. clamp lengths: integer ≤ 9 digits, decimal ≤ 2 places
  intPart = intPart.slice(0, 9);
  decPart = decPart.slice(0, 2);
  if (intPart === '' && hasDecimal) intPart = '0'; // ".5" → "0.5"
  return hasDecimal ? `${intPart}.${decPart}` : intPart;
}
