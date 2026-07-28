import { Colors } from '@/constants/colors';

// Flip to false once the live /api/v1/creators endpoints are reachable
// (or set EXPO_PUBLIC_CREATORS_USE_MOCK=false). Mock-first convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_CREATORS_USE_MOCK ?? 'true') !== 'false';

// Creators REST namespace. Served directly by the Go backend (Gin) under the
// authenticated finance member group — NOT the frontend-web /api/v1 proxy.
// Confirmed against backend/internal/app/top5_p3_routes.go (RegisterCreators
// mounts finance.Group("/creators")) + backend/internal/creators/handler.go
// Register, which re-adds "/creators/..." itself onto that group (so the full
// path is /api/finance/creators/creators/...).
export const API_BASE = '/api/finance/creators/creators';

// Module-scoped colors built on the base design tokens (never hardcode hex).
export const CreatorsColors = {
  brand:      Colors.primary,
  brandBg:    Colors.iconBgPurple,
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

// ── NL-5 — Creator income is content/perks, NOT a financial return. ───────────
// Surfaced verbatim on become-a-creator, subscribe, tip and earnings screens so
// supporters are never led to believe a subscription is an investment.
export const NL5_DISCLOSURE =
  'Supporting a creator buys content and perks — it is NOT an investment and ' +
  'carries no financial return. Tips and subscriptions are non-refundable ' +
  'purchases of access, not deposits.';

// ── NL-11 — Adult / mature content must be age-gated. ─────────────────────────
export const NL11_AGE_GATE_NOTICE =
  'This content is marked 18+. By continuing you confirm you are at least 18 ' +
  'years old. Mature content is restricted and may be reported.';

// ── Payout KYC gate (creators must complete KYC before withdrawing earnings). ─
export const PAYOUT_KYC_NOTICE =
  'To withdraw earnings you must complete identity verification (KYC). This ' +
  'keeps payouts compliant and protects your account.';

// Subscription / entitlement state machine copy (display mirror of backend).
export const SUB_STATUS_LABEL: Record<string, string> = {
  ACTIVE:    'Active',
  PAST_DUE:  'Past due',
  CANCELLED: 'Cancelled',
};

// Money formatting — kobo (minor units) → ₦ string. Mirrors per-module helper.
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

// Idempotency key generator for money-path mutations (tip/subscribe/payout).
export function creatorsIdempotencyKey(): string {
  return `cre-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
