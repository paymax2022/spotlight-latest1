// ── Owner-set packaging price: parsing what they typed ───────────────────────
//
// The owner types NAIRA; the wire, the column and every calculation are integer
// KOBO. That conversion is where money bugs live, so it is a pure function with
// its own tests rather than an inline `Number(x) * 100` in a screen.
//
// The bounds mirror the server exactly (restaurant.UpdateRestaurant rejects
// < 0 and > ₦10,000/pack). Client-side validation is for the owner's benefit —
// the server re-validates and is the authority — but matching the bounds means
// they get a clear message instead of a round-trip and a raw API error.

import type { UpdateStoreInput } from './types';

/** Server ceiling: ₦10,000 per pack, in kobo. Keep in step with maxPackagingFeePerPackKobo. */
export const MAX_PACKAGING_KOBO = 1_000_000;

export type PackagingPriceParse =
  | { ok: true; kobo: number }
  | { ok: false; error: string };

/**
 * Parse a naira amount typed by the owner into integer kobo.
 *
 * Rejects, with a message meant for the owner rather than a developer:
 *   - blank input (they must state a price; 0 is how you charge nothing)
 *   - anything non-numeric
 *   - negatives — a negative fee would subtract from the order total
 *   - more than 2 decimal places, which cannot be represented in kobo
 *   - anything above the server's per-pack ceiling
 *
 * Accepts "200", "200.50", " 1,500 " and "0".
 */
export function parsePackagingPrice(input: string): PackagingPriceParse {
  const raw = input.trim().replace(/,/g, '').replace(/^₦/, '').trim();
  if (!raw) return { ok: false, error: 'Enter a price. Use 0 if you don’t charge for packaging.' };

  if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === '.' || raw === '-') {
    return { ok: false, error: 'Enter a number, like 200 or 200.50.' };
  }
  const naira = Number(raw);
  if (!Number.isFinite(naira)) return { ok: false, error: 'Enter a number, like 200 or 200.50.' };
  if (naira < 0) return { ok: false, error: 'A packaging price can’t be negative.' };

  const decimals = raw.split('.')[1];
  if (decimals && decimals.length > 2) {
    return { ok: false, error: 'Use at most 2 decimal places (kobo).' };
  }

  // Round rather than truncate: in binary floating point 8.29 * 100 is
  // 828.9999999999999, so truncating would charge a kobo less on every pack sold.
  const kobo = Math.round(naira * 100);
  if (kobo > MAX_PACKAGING_KOBO) {
    return { ok: false, error: `That’s above the ₦${(MAX_PACKAGING_KOBO / 100).toLocaleString('en-NG')} limit per pack.` };
  }
  return { ok: true, kobo };
}

/** Kobo → the naira string to seed the input with (no trailing ".00" noise). */
export function packagingPriceInput(kobo: number): string {
  if (!Number.isFinite(kobo) || kobo <= 0) return '0';
  const naira = kobo / 100;
  return Number.isInteger(naira) ? String(naira) : naira.toFixed(2);
}

// ── PATCH body for a store update ────────────────────────────────────────────

/**
 * Map a store patch onto the snake_case body the API expects.
 *
 * Every field is tested with `!== undefined`, never for truthiness. That is the
 * whole reason this is a function with tests: a falsy check would drop
 * `packagingFeeKobo: 0` — an owner switching packaging to free would tap Save,
 * see success, and still be charging for packs. The same trap applies to an
 * empty description.
 */
export function buildUpdateStoreBody(patch: UpdateStoreInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.address !== undefined) body.address = patch.address;
  if (patch.logoUrl !== undefined) body.logo_url = patch.logoUrl;
  if (patch.packagingFeeKobo !== undefined) body.packaging_fee_kobo = patch.packagingFeeKobo;
  return body;
}
