import { Colors } from '@/constants/colors';
import { getDevUrl } from '@/lib/devUrl';
import type { TierBenefit } from '../types/connect.types';

// Flip to false once the live Go-backend /connect endpoints are reachable from
// the app (or set EXPO_PUBLIC_CONNECT_USE_MOCK=false). Mirrors the visitor/realtor
// mock-first convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_CONNECT_USE_MOCK ?? 'true') !== 'false';

// Connect talks DIRECTLY to the Go backend, bypassing the frontend-web :3000
// gateway so the app does NOT depend on that server being up. The shared axios
// `api` client still runs (attaching the Supabase Bearer token) — axios uses an
// absolute URL as-is, ignoring the client's :3000 baseURL. The backend allows the
// Expo web origin (:8083) via CORS_ALLOW_ORIGINS.
//
// Default host is the local backend (:8091, matching backend/.env APP_PORT).
// getDevUrl() rewrites localhost → the dev-machine LAN IP so physical devices and
// emulators still reach it. Override with EXPO_PUBLIC_CONNECT_API_HOST if the
// backend runs elsewhere (e.g. a staging URL).
const CONNECT_API_HOST = process.env.EXPO_PUBLIC_CONNECT_API_HOST ?? 'http://localhost:8091';
export const CONNECT_API_BASE = getDevUrl(`${CONNECT_API_HOST}/api/v1/connect`);

// Module-scoped colors built on the base design tokens (never hardcode hex).
export const ConnectColors = {
  brand:    Colors.primary,
  accent:   Colors.secondary,
  ok:       Colors.teal,
  okBg:     Colors.iconBgTeal,
  warn:     Colors.gold,
  danger:   Colors.error,
  surface:  Colors.surfaceContainerLowest,
  text:     Colors.onSurface,
  muted:    Colors.onSurfaceVariant,
  border:   Colors.outlineVariant,
};

// Tier/KYC catalogue (PRD §7). Money in kobo. These mirror backend-owned config
// for display only — the server is the source of truth for actual limit checks.
// ₦30,000 = 3_000_000 kobo; ₦500,000 = 50_000_000 kobo.
export const TIER_BENEFITS: TierBenefit[] = [
  {
    tier: 0,
    label: 'Tier 0',
    requirement: 'Phone + name (super-app account)',
    dailyLimitKobo: 0,
    privileges: ['Browse & match', 'Chat after a match', 'Watch streams', 'Free voting only'],
  },
  {
    tier: 1,
    label: 'Tier 1',
    requirement: 'BVN or NIN linked',
    dailyLimitKobo: 3_000_000,
    privileges: ['Send & receive small gifts', 'Paid votes within limit', 'Basic gamification'],
  },
  {
    tier: 2,
    label: 'Tier 2',
    requirement: 'BVN + NIN + photo ID + proof of address',
    dailyLimitKobo: 50_000_000,
    privileges: ['Go live & earn', 'Withdraw within limit', 'Creator monetization'],
  },
  {
    tier: 3,
    label: 'Tier 3',
    requirement: 'Tier 2 + liveness + enhanced due diligence',
    dailyLimitKobo: null,
    privileges: ['Highest gifting & withdrawal ceilings', 'Full creator/host payouts'],
  },
];

// 18+ minimum age (SAFETY INVARIANT §1).
export const MIN_AGE = 18;

// Season pass — one-time wallet purchase price (kobo). Lives here in the money-aware
// constants, NOT in the gamification module, which only deals in non-cash coins/XP.
// The charge runs through the shared checkout; unlocking only grants cosmetics/coins.
export const SEASON_PASS_PRICE_KOBO = 200_000; // ₦2,000
