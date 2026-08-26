import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';

// Flip to false once the live /api/v1/loyalty endpoints are reachable
// (or set EXPO_PUBLIC_LOYALTY_USE_MOCK=false). Mock-first convention.
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_LOYALTY_USE_MOCK, true);

// Loyalty REST namespace. Served directly by the Go backend (Gin) under the
// authenticated finance member group — NOT the frontend-web /api/v1 proxy.
// Confirmed against backend/internal/app/top5_p2_routes.go (RegisterLoyalty
// mounts finance.Group("/loyalty") + a sibling points.Handler on the bare
// finance group) + backend/internal/loyalty/handler.go Register.
export const API_BASE = '/api/finance/loyalty';
// Points balance/catalog/redeem live one level up, directly on /api/finance
// (see backend/internal/points/handler.go Register(member) — member there is
// the bare finance group, not finance.Group("/loyalty")).
export const POINTS_API_BASE = '/api/finance';

// Module-scoped colors built on the base design tokens (never hardcode hex).
// Gold-anchored — rewards/elite accent per DESIGN-Mobile.md.
export const LoyaltyColors = {
  brand:      Colors.gold,
  brandBg:    Colors.iconBgGold,
  brandText:  Colors.onWarning,
  accent:     Colors.primary,
  ok:         Colors.teal,
  okBg:       Colors.iconBgTeal,
  danger:     Colors.error,
  surface:    Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text:       Colors.onSurface,
  muted:      Colors.onSurfaceVariant,
  border:     Colors.outlineVariant,
} as const;

// ── NL-4 — Points are NOT cash. Surfaced verbatim wherever points appear. ─────
export const POINTS_NOT_CASH_DISCLOSURE =
  'Points are not money. They are a promotional reward and can never be withdrawn ' +
  'as cash. Redeem them for airtime, bill credits, discounts, and partner perks only.';

export const REDEEM_DISCLOSURE =
  'Redemptions convert points to airtime, bill credit, or a discount — not cash. ' +
  'Once redeemed, points are deducted from your balance and cannot be reversed.';

// Per-tier ladder (TIER1 → TIER2 → TIER3). pointsToNext drives progress UI.
export const TIER_LADDER = [
  { id: 'TIER1', name: 'Bronze',   minPoints: 0,     color: '#B08D57', perks: ['Earn 1 pt / ₦100 spent', 'Birthday bonus', 'Member-only offers'] },
  { id: 'TIER2', name: 'Silver',   minPoints: 5000,  color: '#9CA3AF', perks: ['Earn 1.5 pts / ₦100', 'Priority support', 'Free monthly airtime drop', 'All Bronze perks'] },
  { id: 'TIER3', name: 'Gold',     minPoints: 20000, color: '#EAB308', perks: ['Earn 2 pts / ₦100', 'Dedicated concierge', 'Exclusive event access', 'Waived transfer fees', 'All Silver perks'] },
] as const;

// Points are NON-CASH — format WITHOUT a ₦ sign (NL-4).
export function formatPoints(points: number | null | undefined): string {
  return (points ?? 0).toLocaleString('en-NG') + ' pts';
}

// Money formatting (used only for the NAIRA VALUE of redeemable rewards, never
// for the points themselves). Mirrors the per-module formatNaira convention.
export function formatNaira(kobo: number | null | undefined): string {
  return '₦' + ((kobo ?? 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}
