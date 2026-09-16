// ── Referral (Earn hub) — Constants ──────────────────────────────────────────
// Mirrors the Connect mock-first convention. Money is ALWAYS integer kobo.

import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';

// Flip to false once the live Go-backend /referral endpoints are reachable from
// the app (or set EXPO_PUBLIC_REFERRAL_USE_MOCK=false). Phase 0 stays mock-first.
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_REFERRAL_USE_MOCK, true);

// Referral REST namespace (frontend-web proxy → Go backend /api/finance/referral).
export const REFERRAL_API_BASE = '/api/v1/referral';

// Module-scoped colors built on the base design tokens (never hardcode hex).
// Mirrors Connect's ConnectColors pattern.
export const ReferralColors = {
  brand:    Colors.primary,
  accent:   Colors.secondary,
  ok:       Colors.teal,
  okBg:     Colors.iconBgTeal,
  warn:     Colors.gold,
  warnBg:   Colors.iconBgGold,
  warnText: Colors.onWarning,
  danger:   Colors.error,
  dangerBg: Colors.errorContainer,
  house:    Colors.onSurfaceVariant,
  houseBg:  Colors.surfaceContainer,
  surface:  Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text:     Colors.onSurface,
  muted:    Colors.onSurfaceVariant,
  border:   Colors.outlineVariant,
} as const;

export const REFERRAL_FEATURE_FLAG = 'referral';

// Late code-claim grace window (§7A.3). Display/UX default; the server is the
// source of truth for the actual window and lock state.
export const GRACE_WINDOW_HOURS = 24;

// ── Compliant copy (load-bearing) ────────────────────────────────────────────
// Theme 1 (the pyramid-scheme line): every naira earned ties to a friend's real,
// verified product activity/revenue — NEVER to recruitment or signups alone.
export const COMPLIANT_EARN_LINE =
  'You earn when friends you invite use Paymax for real — complete KYC and make genuine ' +
  'transactions. Earnings are tied to your friends’ verified activity, never to recruitment.';

export const COMPLIANT_EARN_SHORT =
  'Earnings come from friends’ real activity — not from signing people up.';

export const RESPONSIBLE_EARNING_POINTS: string[] = [
  'There is no guaranteed income. You only earn when a referred friend genuinely uses Paymax.',
  'Never pay anyone to "join" or promise people money for signing up — that is not how this works.',
  'Rewards vest over time as your friend proves real activity (KYC, first transaction, staying active).',
  'Caps apply. We do not pay multi-level "downline" bonuses for recruitment.',
  'Suspected fraud (fake accounts, self-referral, bought signups) leads to clawbacks and review.',
];

// ── Earn-state pill catalogue (reward ledger states, PRD §7) ─────────────────
export type EarnStateKey =
  | 'earned'
  | 'pending'
  | 'vesting'
  | 'eligible'
  | 'paid'
  | 'clawed_back';

export const EARN_STATE_META: Record<EarnStateKey, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'accent' }> = {
  earned:      { label: 'Earned',       tone: 'accent' },
  pending:     { label: 'Pending',      tone: 'neutral' },
  vesting:     { label: 'Vesting',      tone: 'warn' },
  eligible:    { label: 'Ready',        tone: 'ok' },
  paid:        { label: 'Paid',         tone: 'ok' },
  clawed_back: { label: 'Clawed back',  tone: 'danger' },
};

// ── Roles / contexts (PRD §3, §5) ────────────────────────────────────────────
export type ReferralRole = 'referrer' | 'ambassador' | 'agent' | 'merchant';

export const ROLE_META: Record<ReferralRole, { label: string; icon: string; blurb: string }> = {
  referrer:   { label: 'Referrer',   icon: 'Users',       blurb: 'Invite friends and earn from their real activity.' },
  ambassador: { label: 'Ambassador', icon: 'BadgeCheck',  blurb: 'Branded links, missions and higher tiers.' },
  agent:      { label: 'Agent',      icon: 'UsersRound',  blurb: 'Build a team; capped, activity-based overrides.' },
  merchant:   { label: 'Merchant',   icon: 'Store',       blurb: 'Fund your own campaigns on the rails.' },
};
