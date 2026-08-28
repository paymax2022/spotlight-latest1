import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';

// ── Direct Referral Rewards — module constants ───────────────────────────────
// Single-level, purchase-triggered revenue share (PRD §5). Distinct from the
// legacy ambassador/agent referral tree under src/features/referral/*.
//
// Mock-first: the mock layer is ON by default so the whole flow walks offline
// (hub → share → referrals → earnings → milestone). Set
// EXPO_PUBLIC_REFERRAL_USE_MOCK=false to hit the live engine via the proxy.
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_REFERRAL_USE_MOCK, true);

// Referral engine namespace — the frontend-web catch-all proxy at
// /api/v1/referrals/<...> forwards to the Go backend /v1/referrals/<...>.
// Composed with the shared axios client baseURL (EXPO_PUBLIC_API_BASE_URL).
export const API_BASE = '/api/v1/referrals';

// Tier enum (PRD §2.2). Order matters: index = progression rank.
export type ReferralTier = 'STARTER' | 'GROWTH' | 'PRO' | 'ELITE';

export interface TierDef {
  tier:      ReferralTier;
  label:     string;
  min_count: number;
  max_count: number | null; // null = open-ended (Elite)
  rate:      number;         // share of platform margin, e.g. 0.05 = 5%
}

// v1 launch defaults (PRD §2.2). The live engine is config-driven; these mirror
// the locked defaults so the explainer/hub render sensibly even before a live
// config version is fetched.
export const TIER_TABLE: TierDef[] = [
  { tier: 'STARTER', label: 'Starter', min_count: 1,    max_count: 49,   rate: 0.05 },
  { tier: 'GROWTH',  label: 'Growth',  min_count: 50,   max_count: 249,  rate: 0.08 },
  { tier: 'PRO',     label: 'Pro',     min_count: 250,  max_count: 999,  rate: 0.12 },
  { tier: 'ELITE',   label: 'Elite',   min_count: 1000, max_count: null, rate: 0.15 },
];

// Milestone bonuses (PRD §2.3) — kobo minor units.
export const MILESTONE_TABLE = [
  { threshold: 10,   bonus_kobo: 500_000 },
  { threshold: 50,   bonus_kobo: 2_000_000 },
  { threshold: 250,  bonus_kobo: 10_000_000 },
  { threshold: 1000, bonus_kobo: 50_000_000 },
] as const;

export function tierDef(tier: ReferralTier): TierDef {
  return TIER_TABLE.find((t) => t.tier === tier) ?? TIER_TABLE[0];
}

// Tier badge palette (built on base tokens, never hardcoded hex).
export const TIER_COLORS: Record<ReferralTier, { fg: string; bg: string }> = {
  STARTER: { fg: Colors.secondary,         bg: Colors.iconBgBlue },
  GROWTH:  { fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  PRO:     { fg: Colors.primary,           bg: Colors.iconBgPurple },
  ELITE:   { fg: Colors.onWarning,         bg: Colors.iconBgGold },
};

// Module-scoped colors (mirror the events module convention).
export const RewardColors = {
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

// The plain-language promise shown on the explainer (PRD §5.1.5) — trust signal.
export const EARN_PROMISE =
  'You earn when someone you referred makes a purchase — never just for referring them.';

// The share message pre-filled into the native share sheet (WhatsApp-first).
export function shareMessage(code: string, link: string): string {
  return (
    `Join me on Spotlight — Nigeria's super app for payments, events, shopping and more. ` +
    `Use my code ${code} when you sign up: ${link}`
  );
}

// ── Money formatting — kobo (minor units). Never float math on money. ────────
export function formatNaira(kobo: number | null | undefined, opts?: { decimals?: boolean }): string {
  if (kobo == null) return '—';
  const value = kobo / 100;
  const fractionDigits = opts?.decimals ? 2 : 0;
  return '₦' + value.toLocaleString('en-NG', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatNairaCompact(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  const value = kobo / 100;
  if (value >= 1_000_000) return '₦' + (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (value >= 1_000)     return '₦' + (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '₦' + value.toLocaleString('en-NG');
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// Relative "time ago" for ledger/timeline rows.
export function relativeTime(iso: string | number | Date | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}
