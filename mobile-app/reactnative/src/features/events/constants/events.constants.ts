import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';

// Mock unless explicitly disabled — matches the app-wide convention used by
// every other module ((X ?? 'true') !== 'false'). The env var name is the
// singular EXPO_PUBLIC_EVENT_USE_MOCK, matching .env / .env.example; the old
// plural EXPO_PUBLIC_EVENTS_USE_MOCK never matched the configured flag, so the
// toggle silently did nothing and the module always hit the live backend.
export const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_EVENT_USE_MOCK, true);

// Events REST namespace — Go backend `top5events` module, mounted directly
// under /api/finance/events/* (see backend/internal/top5events). Composed
// with the shared axios client's baseURL (EXPO_PUBLIC_API_BASE_URL) in api.ts.
export const API_BASE = '/api/finance/events';

// Module-scoped colors built on the base design tokens (never hardcode hex).
export const EventColors = {
  brand:      Colors.primary,
  accent:     Colors.secondary,
  ok:         Colors.teal,
  okBg:       Colors.iconBgTeal,
  warn:       Colors.gold,
  warnBg:     Colors.iconBgGold,
  warnText:   Colors.onWarning,
  danger:     Colors.error,
  dangerBg:   Colors.errorContainer,
  surface:    Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text:       Colors.onSurface,
  muted:      Colors.onSurfaceVariant,
  border:     Colors.outlineVariant,
} as const;

// ── Compliance copy (NL-3 closed-loop value only) ────────────────────────────
// Surfaced verbatim on the event-wallet top-up / withdraw screens.
export const EVENT_WALLET_DISCLOSURE =
  'Your event wallet is closed-loop: balance is spendable only with vendors inside ' +
  'this event. After the event, any unspent balance refunds to your main Paymax wallet.';

export const RESIDUAL_REFUND_DISCLOSURE =
  'Unspent event-wallet balance is refunded to your main Paymax wallet. ' +
  'Event wallets cannot be cashed out directly or used outside the event.';

// Money formatting — kobo (minor units) → ₦ string. Mirrors the per-module
// formatNaira convention used across the app (no shared util exists).
export function formatNaira(kobo: number | null | undefined, opts?: { decimals?: boolean }): string {
  const value = (kobo ?? 0) / 100;
  const fractionDigits = opts?.decimals ? 2 : 0;
  return '₦' + value.toLocaleString('en-NG', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatNairaCompact(kobo: number | null | undefined): string {
  const value = (kobo ?? 0) / 100;
  if (value >= 1_000_000) return '₦' + (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (value >= 1_000)     return '₦' + (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '₦' + value.toLocaleString('en-NG');
}

// Event discovery filters (drive the segmented filter row).
export const EVENT_CATEGORIES = [
  { value: 'all',      label: 'All' },
  { value: 'music',    label: 'Music' },
  { value: 'tech',     label: 'Tech' },
  { value: 'sports',   label: 'Sports' },
  { value: 'comedy',   label: 'Comedy' },
  { value: 'faith',    label: 'Faith' },
] as const;

// ── Display-only cover art (backend has no cover image / banner color field) ─
// Deterministic per-category (with an id-based color shade) so cards look
// distinct without depending on any network-provided art asset.
const CATEGORY_EMOJI: Record<string, string> = {
  music:   '🎷',
  tech:    '💻',
  sports:  '⚽',
  comedy:  '🎤',
  faith:   '🙏',
};

const CATEGORY_BANNER: Record<string, string> = {
  music:   '#340075',
  tech:    '#0051D5',
  sports:  '#0F766E',
  comedy:  '#EAB308',
  faith:   '#9A3412',
};

// Simple string hash → stable pseudo-random pick, used only to vary the shade
// of a category's banner color slightly per event id (cosmetic only).
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function eventCoverEmoji(category: string): string {
  return CATEGORY_EMOJI[category] ?? '🎟️';
}

export function eventBannerColor(id: string, category: string): string {
  const base = CATEGORY_BANNER[category] ?? '#340075';
  // Alternate between the base shade and a slightly lighter/darker variant
  // per id so a list of same-category cards isn't monotone.
  return hashId(id) % 2 === 0 ? base : base + 'CC';
}

// ── Event state → badge label/color (real backend enum: DRAFT | SUBMITTED |
// APPROVED | LIVE | CLOSED | SUSPENDED). Discovery only ever shows
// non-draft/non-suspended events, but the map covers every state defensively.
export const EVENT_STATE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  LIVE:      { label: 'Live now',  color: EventColors.danger,   bg: EventColors.dangerBg },
  APPROVED:  { label: 'On sale',   color: EventColors.ok,       bg: EventColors.okBg },
  SUBMITTED: { label: 'Pending',   color: EventColors.warnText, bg: EventColors.warnBg },
  DRAFT:     { label: 'Draft',     color: EventColors.warnText, bg: EventColors.warnBg },
  CLOSED:    { label: 'Ended',     color: EventColors.muted,    bg: EventColors.surfaceAlt },
  SUSPENDED: { label: 'Suspended', color: EventColors.danger,   bg: EventColors.dangerBg },
};

// Ticket state → badge label/color (real backend enum: ISSUED | TRANSFERRED |
// USED | REFUNDED).
export const TICKET_STATE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  ISSUED:      { label: 'Valid',       color: EventColors.ok,       bg: EventColors.okBg },
  USED:        { label: 'Used',        color: EventColors.muted,    bg: EventColors.surfaceAlt },
  TRANSFERRED: { label: 'Transferred', color: EventColors.warnText, bg: EventColors.warnBg },
  REFUNDED:    { label: 'Refunded',    color: EventColors.danger,   bg: EventColors.dangerBg },
};
