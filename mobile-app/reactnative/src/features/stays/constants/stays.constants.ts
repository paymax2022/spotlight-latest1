// ── Paymax Stays (Hotel Booking) — Constants & module tokens ─────────────────
// Mock-first convention (mirrors connect / insurance / realtor). Flip to false
// (or set EXPO_PUBLIC_STAYS_USE_MOCK=false) once the live Go-backend stays
// endpoints are reachable via the frontend-web proxy.
//
// IRON RULE: all monetary amounts are integers in minor units (kobo). FX: every
// price carries an explicit currency; NGN is the default, USD-priced upscale
// supply is converted with a visible note (never silent — PRD §12 / build-plan §2).

import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';

export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_STAYS_USE_MOCK, true);

// Stays REST namespace. The Next.js gateway rewrites /api/finance/:path* to the
// Go backend verbatim (see frontend-web/next.config.mjs), and the Go stays
// module is registered at /api/finance/stays (backend/internal/app/stays_routes.go).
// NOTE: Go currently only implements search/consent/prebook/book/reservations —
// the richer mobile surface (home, deals, destinations, agent/*, reviews/*,
// loyalty, saved-guests, trips/* cancel+modify) has NO backend route yet; those
// calls will 404 once USE_MOCK is flipped until the backend cluster adds them.
export const STAYS_API_BASE = '/api/finance/stays';

export const MOCK_DELAY_MS = 320;

// Module-scoped colors built on the base design tokens (mirror ConnectColors —
// never hardcode hex). Stays leans on the deep-purple brand with teal accents.
export const StaysColors = {
  brand:      Colors.primary,
  accent:     Colors.secondary,
  ok:         Colors.teal,
  okBg:       Colors.iconBgTeal,
  warn:       Colors.gold,
  warnText:   Colors.onWarning,
  danger:     Colors.error,
  dangerBg:   Colors.errorContainer,
  surface:    Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text:       Colors.onSurface,
  muted:      Colors.onSurfaceVariant,
  border:     Colors.outlineVariant,
  // Map pin tints.
  pin:        Colors.primary,
  pinActive:  Colors.secondary,
  pinSoldOut: Colors.error,
  // Loyalty / rewards.
  loyalty:    Colors.gold,
  loyaltyBg:  Colors.iconBgGold,
} as const;

// ── FX (PRD §12 — FX display, never silent) ──────────────────────────────────
// Display rate used to show an indicative NGN equivalent for USD-priced supply.
// Live path takes the controlled conversion from the backend; this is the mock
// indicative rate. ALWAYS shown with a note that final charge is in NGN.
export const USD_NGN_RATE = 1650;

export type Currency = 'NGN' | 'USD';

/** ₦ formatting from kobo. 25_000_000 → "₦250,000". Never divide inline. */
export function formatNaira(kobo: number, opts?: { decimals?: boolean }): string {
  const naira = kobo / 100;
  return (
    '₦' +
    naira.toLocaleString('en-NG', {
      minimumFractionDigits: opts?.decimals ? 2 : 0,
      maximumFractionDigits: opts?.decimals ? 2 : 0,
    })
  );
}

/** Compact ₦ for cards / pins. 25_000_000 kobo → "₦250k". */
export function formatNairaCompact(kobo: number): string {
  const naira = kobo / 100;
  if (naira >= 1_000_000) return `₦${trimZero(naira / 1_000_000)}M`;
  if (naira >= 1_000) return `₦${trimZero(naira / 1_000)}k`;
  return `₦${Math.round(naira).toLocaleString('en-NG')}`;
}

function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/** $ formatting from cents (minor units). 250_00 → "$250". */
export function formatUsd(cents: number, opts?: { decimals?: boolean }): string {
  const dollars = cents / 100;
  return (
    '$' +
    dollars.toLocaleString('en-US', {
      minimumFractionDigits: opts?.decimals ? 2 : 0,
      maximumFractionDigits: opts?.decimals ? 2 : 0,
    })
  );
}

/**
 * Currency-aware price label. Every price in the UI MUST go through this so the
 * currency is always visible. USD prices append an indicative NGN equivalent.
 */
export function formatMoney(
  amountMinor: number,
  currency: Currency,
  opts?: { decimals?: boolean; compact?: boolean },
): string {
  if (currency === 'USD') return opts?.compact ? `$${trimZero(amountMinor / 100)}` : formatUsd(amountMinor, opts);
  return opts?.compact ? formatNairaCompact(amountMinor) : formatNaira(amountMinor, opts);
}

/** Indicative NGN equivalent (kobo) of a USD amount in cents — for display only. */
export function usdCentsToNgnKobo(cents: number): number {
  // cents → USD → NGN → kobo
  return Math.round((cents / 100) * USD_NGN_RATE * 100);
}

/**
 * The NGN amount (kobo) actually charged for a price, regardless of display
 * currency. The wallet/ledger only ever moves Naira (PRD §12 — Naira settlement).
 */
export function chargeableKobo(amountMinor: number, currency: Currency): number {
  return currency === 'USD' ? usdCentsToNgnKobo(amountMinor) : amountMinor;
}

/**
 * Idempotency-Key for money-path mutations (book/cancel). Mirrors the money-path
 * convention so a retried Book can't double-create / double-charge.
 */
export function newIdempotencyKey(): string {
  return `stay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Error taxonomy (PRD §28.A — normalised, rail-agnostic) ───────────────────
export const STAYS_ERRORS = {
  OFFER_EXPIRED: 'This price offer has expired. We refreshed the rates for you.',
  PREBOOK_PRICE_CHANGED: 'The price changed since you started. Review the updated total before booking.',
  PREBOOK_SOLD_OUT: 'This room just sold out. Here are similar stays still available.',
  INSUFFICIENT_FUNDS: 'Your wallet balance is too low. Top up or choose another payment method.',
  PAYMENT_FAILED: 'We could not take payment. No money was held. Please try again.',
  BOOK_REJECTED_BY_SUPPLIER: 'The hotel could not confirm this booking. Your hold was released — you were not charged.',
  SUPPLIER_TIMEOUT: 'The hotel did not respond in time. Your hold was released — you were not charged.',
  OVERSELL_BLOCKED: 'The last room was taken moments ago. No charge was made.',
  CANCELLATION_NOT_ALLOWED: 'This rate is non-refundable and cannot be cancelled.',
  DUPLICATE_REQUEST: 'This booking was already submitted.',
  MAPPING_CONFLICT: 'We hit a supply conflict. Please try a different rate.',
} as const;

export type StaysErrorCode = keyof typeof STAYS_ERRORS;

// ── Filter / sort catalogues (PRD §15) ───────────────────────────────────────
export const SORT_OPTIONS = [
  { value: 'top_picks', label: 'Top picks' },
  { value: 'price_asc', label: 'Price (low to high)' },
  { value: 'price_desc', label: 'Price (high to low)' },
  { value: 'review_score', label: 'Review score' },
  { value: 'distance', label: 'Distance' },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]['value'];

export const STAR_OPTIONS = [3, 4, 5] as const;

export const PROPERTY_TYPES = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'guesthouse', label: 'Guesthouse' },
  { value: 'resort', label: 'Resort' },
] as const;

// Amenity catalogue — each maps to a lucide icon name (verified on disk).
export const AMENITIES: { key: string; label: string; icon: string }[] = [
  { key: 'wifi', label: 'Free WiFi', icon: 'Wifi' },
  { key: 'parking', label: 'Free parking', icon: 'SquareParking' },
  { key: 'pool', label: 'Swimming pool', icon: 'Waves' },
  { key: 'ac', label: 'Air conditioning', icon: 'Wind' },
  { key: 'breakfast', label: 'Breakfast', icon: 'Coffee' },
  { key: 'restaurant', label: 'Restaurant', icon: 'UtensilsCrossed' },
  { key: 'gym', label: 'Fitness centre', icon: 'Dumbbell' },
  { key: 'shuttle', label: 'Airport shuttle', icon: 'Car' },
];

export const AMENITY_LABEL: Record<string, string> = Object.fromEntries(
  AMENITIES.map((a) => [a.key, a.label]),
);
export const AMENITY_ICON: Record<string, string> = Object.fromEntries(
  AMENITIES.map((a) => [a.key, a.icon]),
);

// Review sub-score dimensions (PRD §14).
export const REVIEW_DIMENSIONS = [
  'cleanliness',
  'staff',
  'location',
  'value',
  'comfort',
  'facilities',
  'wifi',
] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

export const REVIEW_DIMENSION_LABEL: Record<ReviewDimension, string> = {
  cleanliness: 'Cleanliness',
  staff: 'Staff',
  location: 'Location',
  value: 'Value',
  comfort: 'Comfort',
  facilities: 'Facilities',
  wifi: 'Free WiFi',
};

/** Booking.com-style word for a review score out of 10. */
export function scoreWord(score: number): string {
  if (score >= 9) return 'Superb';
  if (score >= 8) return 'Very good';
  if (score >= 7) return 'Good';
  if (score >= 6) return 'Pleasant';
  return 'Review score';
}

// ── Date & guest display helpers (shared across screens) ─────────────────────
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(`${checkIn}T00:00:00`).getTime();
  const b = new Date(`${checkOut}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** "Mon, 23 Jun" */
export function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "23 Jun – 25 Jun · 2 nights" */
export function formatStayRange(checkIn: string, checkOut: string): string {
  const n = nightsBetween(checkIn, checkOut);
  return `${formatShortDate(checkIn)} – ${formatShortDate(checkOut)} · ${n} night${n > 1 ? 's' : ''}`;
}

/** "2 adults · 1 room" */
export function formatGuestSummary(g: { adults: number; children: number; rooms: number }): string {
  const parts = [`${g.adults} adult${g.adults > 1 ? 's' : ''}`];
  if (g.children > 0) parts.push(`${g.children} child${g.children > 1 ? 'ren' : ''}`);
  parts.push(`${g.rooms} room${g.rooms > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

export const BOARD_LABEL: Record<string, string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Half board',
  full_board: 'Full board',
};
