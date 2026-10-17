// its own tests rather than an inline `Number(x) * 100` in a screen.
// The bounds mirror the server exactly (restaurant.UpdateRestaurant rejects
// < 0 and > ₦10,000/pack). Client-side validation is for the owner's benefit —
// the server re-validates and is the authority — but matching the bounds means
// they get a clear message instead of a round-trip and a raw API error.

import type { UpdateStoreInput } from './types';
import { parseNaira, PACKAGING_BOUNDS } from './money';

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
  // Blank is its own message: 0 is how an owner charges nothing, so "empty" must not read as "free".
  if (!input.trim().replace(/^₦/, '').trim()) {
    return { ok: false, error: 'Enter a price. Use 0 if you don’t charge for packaging.' };
  }
  const r = parseNaira(input, PACKAGING_BOUNDS);
  return r.ok ? { ok: true, kobo: r.kobo } : { ok: false, error: r.error.replace('The price', 'A packaging price') };
}

/** Kobo → the naira string to seed the input with (no trailing ".00" noise). */
export function packagingPriceInput(kobo: number): string {
  if (!Number.isFinite(kobo) || kobo <= 0) return '0';
  const naira = kobo / 100;
  return Number.isInteger(naira) ? String(naira) : naira.toFixed(2);
}

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
  if (patch.bannerUrl !== undefined) body.banner_url = patch.bannerUrl;
  if (patch.packagingFeeKobo !== undefined) body.packaging_fee_kobo = patch.packagingFeeKobo;
  if (patch.geo !== undefined) {
    body.geo_lat = patch.geo?.lat;
    body.geo_lng = patch.geo?.lng;
    body.plus_code = patch.geo?.plusCode;
  }
  return body;
}
