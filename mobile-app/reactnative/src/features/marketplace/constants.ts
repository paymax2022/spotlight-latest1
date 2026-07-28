// ── Marketplace — shared UI constants & formatting ───────────────────────────
// Built on the base design tokens (never hardcode hex). Imported across the
// Discover screens and shared with sibling agents so money reads identically.
import { Colors } from '@/constants/colors';
import type { ListingCondition } from './types';

export const MarketColors = {
  brand: Colors.primary,
  accent: Colors.secondary,
  ok: Colors.teal,
  okBg: Colors.iconBgTeal,
  warn: Colors.gold,
  warnBg: Colors.iconBgGold,
  warnText: Colors.onWarning,
  danger: Colors.error,
  dangerBg: Colors.errorContainer,
  surface: Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text: Colors.onSurface,
  muted: Colors.onSurfaceVariant,
  border: Colors.outlineVariant,
};

/** kobo (minor units) → ₦ string. Integer naira by default. */
export function formatNaira(kobo: number | null | undefined, opts?: { decimals?: boolean }): string {
  const value = (kobo ?? 0) / 100;
  const fractionDigits = opts?.decimals ? 2 : 0;
  return (
    '₦' +
    value.toLocaleString('en-NG', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  );
}

export const CONDITION_LABELS: Record<ListingCondition, string> = {
  new: 'New',
  used: 'Used',
  foreign_used: 'Foreign Used',
  local_used: 'Local Used',
  refurbished: 'Refurbished',
};

export function conditionLabel(c: string): string {
  return (CONDITION_LABELS as Record<string, string>)[c] ?? c;
}

/**
 * Fair-price verdict for a listing vs its server-computed band. Drives the
 * fair-price chip (below / at / above market) on cards and Listing Detail.
 */
export type FairPriceVerdict = 'below' | 'fair' | 'above' | 'unknown';

export function fairPriceVerdict(
  priceKobo: number,
  band: { p25Kobo: number; p50Kobo: number; p75Kobo: number } | null | undefined,
): FairPriceVerdict {
  if (!band) return 'unknown';
  if (priceKobo < band.p25Kobo) return 'below';
  if (priceKobo > band.p75Kobo) return 'above';
  return 'fair';
}

export const FAIR_PRICE_LABEL: Record<FairPriceVerdict, string> = {
  below: 'Below market',
  fair: 'Fair price',
  above: 'Above market',
  unknown: '',
};

// Connect model: Paymax lists services and connects both parties — it never
// holds funds. These strings frame the off-platform, meet-in-person safety
// message that replaces the old escrow copy everywhere it was shown.
export const CONNECT_SAFETY_STRIP =
  "Meet in a safe place — Paymax connects buyers and sellers but doesn't hold funds for this deal.";

export const MEETUP_SAFETY_NUDGE =
  "Meet in a safe public place — Paymax doesn't hold funds for this deal. Pay only in person, once you've seen the item.";
