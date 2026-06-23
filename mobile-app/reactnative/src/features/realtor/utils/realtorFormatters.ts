// ── Spotlight Realtor — Formatting & helpers ─────────────────────────────────
// Money is integer minor units (kobo). Display helpers never mutate amounts.

import type { Kobo, RentSchedule, TransactionMode, Listing, ListingCard } from '../types/realtor.types';
import { SCHEDULE_LABEL, MODE_LABEL } from '../constants/realtor.constants';

/** ₦ formatting from kobo. 25_000_000 → "₦250,000". */
export function formatNaira(kobo: Kobo, opts?: { decimals?: boolean }): string {
  const naira = kobo / 100;
  const str = naira.toLocaleString('en-NG', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  });
  return `₦${str}`;
}

/** Compact ₦ for cards. 250000000 kobo → "₦2.5M". */
export function formatNairaCompact(kobo: Kobo): string {
  const naira = kobo / 100;
  if (naira >= 1_000_000) return `₦${trimZero(naira / 1_000_000)}M`;
  if (naira >= 1_000) return `₦${trimZero(naira / 1_000)}k`;
  return `₦${naira.toLocaleString('en-NG')}`;
}

function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/** Headline price string per offering mode (compact, for cards). */
export function priceLabel(card: Pick<ListingCard, 'mode' | 'price' | 'nightlyPrice' | 'rentSchedule'>): string {
  if (card.mode === 'short_stay' && card.nightlyPrice != null) {
    return `${formatNairaCompact(card.nightlyPrice)}/night`;
  }
  if ((card.mode === 'long_rent' || card.mode === 'for_lease') && card.rentSchedule) {
    return `${formatNairaCompact(card.price)} ${SCHEDULE_LABEL[card.rentSchedule]}`;
  }
  return formatNairaCompact(card.price);
}

/** Full (uncompacted) price string for the listing-detail header. */
export function priceLabelFull(listing: Listing): string {
  if (listing.mode === 'short_stay' && listing.nightlyPrice != null) {
    return `${formatNaira(listing.nightlyPrice)} / night`;
  }
  if ((listing.mode === 'long_rent' || listing.mode === 'for_lease') && listing.rentSchedule) {
    return `${formatNaira(listing.price)} ${SCHEDULE_LABEL[listing.rentSchedule]}`;
  }
  return formatNaira(listing.price);
}

export function modeLabel(mode: TransactionMode): string {
  return MODE_LABEL[mode];
}

/** "3 bed · 2 bath" summary string. */
export function bedBathLabel(bedrooms: number, bathrooms: number): string {
  const bed = bedrooms > 0 ? `${bedrooms} bed` : 'Studio';
  return `${bed} · ${bathrooms} bath`;
}

/** Human "2 days ago" from an ISO timestamp. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (diff < 3_600_000) return 'Just now';
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

/** Friendly date label for inspection slots, e.g. "Mon, 23 Jun". */
export function formatSlotDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Idempotency-Key for funnel mutations (inspection/application submit). Mirrors
 * the money-path convention so the same submit can't double-fire on retry.
 */
export function newIdempotencyKey(): string {
  return `rl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
