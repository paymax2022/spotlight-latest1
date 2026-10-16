// ── Restaurant money input — pure rules ──────────────────────────────────────
// One place for how an owner's typed price becomes integer kobo and back, so the
// item form, the legacy add-item row and the packaging card cannot drift apart.
//
// Currency is NGN, always. Amounts are parsed from TEXT straight to integer kobo
// and never through a float: 8.29 * 100 is 828.9999999999999 in binary floating
// point, so a `Number(x) * 100` would quietly charge a kobo less than the owner
// typed. Kept free of react-native imports so it runs under `node --test`.
//
// The ceilings mirror the server, which is the authority — the client check only
// exists so the owner gets a clear message instead of a round trip and a raw API
// error:
//   menu item  : > 0 and <= ₦1,000,000   (restaurant.validateItemPriceKobo; the app
//                keeps requiring > 0 — a free menu item is almost always a slip)
//   packaging  : >= 0 and <= ₦10,000     (restaurant.maxPackagingFeePerPackKobo)

export const CURRENCY_CODE = 'NGN';
export const NAIRA_SYMBOL = '₦';

export interface MoneyBounds {
  minKobo: number;
  maxKobo: number;
}

export const ITEM_PRICE_BOUNDS: MoneyBounds = { minKobo: 1, maxKobo: 100_000_000 };
export const PACKAGING_BOUNDS: MoneyBounds = { minKobo: 0, maxKobo: 1_000_000 };

/** More integer digits than this can't be a price here; also keeps kobo a safe integer. */
const MAX_INTEGER_DIGITS = 12;

export type NairaParse = { ok: true; kobo: number } | { ok: false; error: string };

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Kobo → "₦2,500" or "₦2,500.50". Whole naira drop the ".00". Never prints NaN. */
export function formatNaira(kobo: number): string {
  if (!Number.isFinite(kobo)) return `${NAIRA_SYMBOL}0`;
  const rounded = Math.round(kobo);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.trunc(abs / 100);
  const rest = abs % 100;
  const body = `${NAIRA_SYMBOL}${group(String(whole))}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
  return negative ? `-${body}` : body;
}

/**
 * Filter what the owner types down to something that can be money: digits and at
 * most one decimal point, at most two decimals. The naira sign, commas, spaces,
 * letters, minus signs and exponents are dropped as they are typed, so the field
 * can never hold "-5" or "1e3". Leading zeros are trimmed ("007" -> "7").
 */
export function sanitizeNairaInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return '';
  const dot = cleaned.indexOf('.');
  const hasDot = dot !== -1;
  const intPart = (hasDot ? cleaned.slice(0, dot) : cleaned).replace(/^0+(?=\d)/, '');
  const frac = hasDot ? cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2) : '';
  if (!hasDot) return intPart;
  return `${intPart === '' ? '0' : intPart}.${frac}`;
}

/**
 * Parse a naira amount typed by the owner into integer kobo, within `bounds`.
 * Error text is written for the owner. Accepts "2500", "350.5", "₦1,500", "0.10".
 */
export function parseNaira(input: string, bounds: MoneyBounds): NairaParse {
  let s = input.trim().replace(/^₦/, '').replace(/[,\s]/g, '');
  // "200." and ".5" are what the field holds mid-typing; both mean what they say.
  if (/^\d+\.$/.test(s)) s = s.slice(0, -1);
  if (/^\.\d{1,2}$/.test(s)) s = `0${s}`;
  if (!s) return { ok: false, error: 'Enter a price in naira.' };
  if (s.startsWith('-')) return { ok: false, error: 'A price can’t be negative.' };
  if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: 'Use at most 2 decimal places (kobo).' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return { ok: false, error: 'Enter an amount in naira, like 2500 or 2500.50.' };
  }

  const [whole, frac = ''] = s.split('.');
  if (whole.replace(/^0+(?=\d)/, '').length > MAX_INTEGER_DIGITS) {
    return { ok: false, error: `That’s above the ${formatNaira(bounds.maxKobo)} limit.` };
  }
  const kobo = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(kobo)) {
    return { ok: false, error: `That’s above the ${formatNaira(bounds.maxKobo)} limit.` };
  }
  if (kobo < bounds.minKobo) {
    return {
      ok: false,
      error: bounds.minKobo >= 1 ? `The price must be more than ${NAIRA_SYMBOL}0.` : 'Enter a valid price.',
    };
  }
  if (kobo > bounds.maxKobo) {
    return { ok: false, error: `That’s above the ${formatNaira(bounds.maxKobo)} limit.` };
  }
  return { ok: true, kobo };
}
