// ── Insurance (live) — price presentation ───────────────────────────────────
// PURE. No `@/` imports, no React — so it unit-tests under plain `node --test`.
//
// Two things this file exists to stop:
//   1. Rendering a PERCENTAGE product as if it were a flat naira price. MyCover's
//      `base_price` is a RATE for 27 of 68 products (0.5 → 0.5% of sum insured).
//      Printing "₦0.50" for a goods-in-transit cover misprices it by six orders
//      of magnitude to the user's eye. FLAT and PERCENTAGE render differently.
//   2. Inline `kobo / 100` arithmetic in components. Every naira string in the
//      module comes out of here or `formatNaira`.

import type { Product } from './types';

/** Format an integer kobo amount as naira. Kobo are shown only when non-zero. */
export function nairaFromKobo(kobo: number, opts?: { decimals?: boolean }): string {
  const safe = Number.isFinite(kobo) ? Math.trunc(kobo) : 0;
  const showDecimals = opts?.decimals ?? safe % 100 !== 0;
  return (
    '₦' +
    (safe / 100).toLocaleString('en-NG', {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    })
  );
}

/** Compact naira for stat tiles — ₦11,500,000 → "₦11.5M". */
export function nairaCompact(kobo: number): string {
  const naira = (Number.isFinite(kobo) ? Math.trunc(kobo) : 0) / 100;
  if (naira >= 1_000_000_000) return '₦' + trimZero(naira / 1_000_000_000) + 'B';
  if (naira >= 1_000_000) return '₦' + trimZero(naira / 1_000_000) + 'M';
  if (naira >= 10_000) return '₦' + trimZero(naira / 1_000) + 'k';
  return '₦' + naira.toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

function trimZero(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** Basis points → a human percent ("50" → "0.5%", "250" → "2.5%", "100" → "1%"). */
export function percentFromBps(bps: number): string {
  const safe = Number.isFinite(bps) ? bps : 0;
  const whole = Math.trunc(safe / 100);
  const frac = Math.abs(safe % 100);
  if (frac === 0) return `${whole}%`;
  const fracStr = String(frac).padStart(2, '0').replace(/0$/, '');
  return `${whole}.${fracStr}%`;
}

/**
 * Cover period in days → the cadence suffix a price carries.
 * MyCover's real cover_period values are 1, 2, 7, 12, 30, 180 and 365.
 */
export function cadenceLabel(coverPeriodDays: number): string {
  const d = Math.max(0, Math.trunc(coverPeriodDays || 0));
  if (d >= 360) return '/yr';
  if (d >= 170) return '/6mo';
  if (d >= 28) return '/mo';
  if (d >= 7) return '/wk';
  if (d > 0) return `/${d}d`;
  return '';
}

/** Long form of the same, for detail screens ("365 days · renews yearly"). */
export function coverPeriodLabel(coverPeriodDays: number): string {
  const d = Math.max(0, Math.trunc(coverPeriodDays || 0));
  if (d === 0) return 'Cover period varies';
  if (d >= 360) return '1 year cover';
  if (d >= 170) return '6 months cover';
  if (d >= 28) return `${Math.round(d / 30)} month${d >= 56 ? 's' : ''} cover`;
  if (d === 1) return '1 day cover';
  return `${d} days cover`;
}

export interface PriceDisplay {
  /** The big line — "₦6,000" or "0.5%". */
  headline: string;
  /** The small line beside it — "/yr" or "of value insured". */
  suffix: string;
  /** Word placed before the headline, or '' when the price is exact. */
  prefix: string;
  kind: 'flat' | 'percentage';
  /** One-line accessibility/summary phrasing. */
  a11y: string;
}

/**
 * The single place a catalog price is turned into words.
 *
 * FLAT       → "₦6,000 /yr"                   (exact, so no "from")
 * PERCENTAGE → "from 0.5% of value insured"   (premium depends on sum insured)
 */
export function priceDisplay(product: Pick<
  Product,
  'basePriceKobo' | 'isPercentage' | 'rateBps' | 'coverPeriodDays' | 'name'
>): PriceDisplay {
  if (product.isPercentage) {
    const pct = percentFromBps(product.rateBps);
    return {
      headline: pct,
      suffix: 'of value insured',
      prefix: 'from',
      kind: 'percentage',
      a11y: `${product.name}, from ${pct} of the value you insure`,
    };
  }
  const amount = nairaFromKobo(product.basePriceKobo);
  const suffix = cadenceLabel(product.coverPeriodDays);
  return {
    headline: amount,
    suffix,
    prefix: '',
    kind: 'flat',
    a11y: `${product.name}, ${amount} ${suffix ? suffix.replace('/', 'per ') : ''}`.trim(),
  };
}

/**
 * Indicative premium for a PERCENTAGE product, used ONLY to preview a number
 * while the user types a declared value. Integer math end to end:
 * premium = sumInsuredKobo × rateBps / 10_000.
 *
 * This is never the number the user is charged — the binding premium comes back
 * from the server on the quote. Callers must label it as an estimate.
 */
export function indicativePremiumKobo(sumInsuredKobo: number, rateBps: number): number {
  const s = Number.isFinite(sumInsuredKobo) ? Math.trunc(sumInsuredKobo) : 0;
  const r = Number.isFinite(rateBps) ? Math.trunc(rateBps) : 0;
  if (s <= 0 || r <= 0) return 0;
  return Math.round((s * r) / 10_000);
}

/** Parse a typed naira string ("1,500.50") to integer kobo. */
export function nairaInputToKobo(raw: string): number {
  const clean = String(raw ?? '').replace(/[^\d.]/g, '');
  if (!clean) return 0;
  const [int = '0', dec = ''] = clean.split('.');
  const kobo = Number(int) * 100 + Number((dec + '00').slice(0, 2));
  return Number.isFinite(kobo) ? Math.trunc(kobo) : 0;
}
