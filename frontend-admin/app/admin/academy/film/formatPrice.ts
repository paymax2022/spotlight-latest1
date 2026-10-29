/** Largest whole-naira value academy_area_pricing_options.price_ngn (numeric(12,2)) holds. */
export const MAX_FORMAT_PRICE_NGN = 9_999_999_999;

export const FORMAT_PRICE_HINT = 'Whole naira, above zero';

/**
 * A tuition-format price as typed by an admin: digits only, a safe integer,
 * above zero, within the column. Returns null for anything else — blank is
 * NOT 0 (a ₦0 format makes tuition fall back to the batch fee, a figure the
 * applicant never saw). Mirrors the server rule in
 * frontend-web/app/api/admin/academy/interest-areas/route.ts.
 */
export function parseFormatPriceInput(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_FORMAT_PRICE_NGN) return null;
  return n;
}
