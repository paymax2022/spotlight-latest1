import { Colors } from '@/constants/colors';

// Flip to false once the live /api/v1/savings endpoints are reachable
// (or set EXPO_PUBLIC_SAVINGS_USE_MOCK=false). Mock-first convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_SAVINGS_USE_MOCK ?? 'true') !== 'false';

// Savings REST namespace. Backend mounts the savings handler on the finance
// member group at /api/finance/savings/* (backend/internal/app/top5_p1_routes.go).
export const API_BASE = '/api/finance/savings';

// Module-scoped colors built on the base design tokens (never hardcode hex).
export const SavingsColors = {
  brand:    Colors.primary,
  accent:   Colors.secondary,
  ok:       Colors.teal,
  okBg:     Colors.iconBgTeal,
  warn:     Colors.gold,
  warnBg:   Colors.iconBgGold,
  warnText: Colors.onWarning,
  danger:   Colors.error,
  dangerBg: Colors.errorContainer,
  surface:  Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text:     Colors.onSurface,
  muted:    Colors.onSurfaceVariant,
  border:   Colors.outlineVariant,
};

// ── Compliance copy (NL-2 no yield, NL-7 Ajo peer rotation) ──────────────────
// These strings are surfaced verbatim on the relevant screens.
export const NO_YIELD_DISCLOSURE =
  'Savings vaults earn no interest or returns. Paymax safely holds your money; ' +
  'your balance only grows from what you put in.';

export const AJO_ROTATION_DISCLOSURE =
  'Ajo / Esusu is peer-to-peer rotational saving. Members fund each other and take ' +
  'turns receiving the pooled payout. Paymax is the ledger and escrow only — it never ' +
  'lends, guarantees contributions, or pays interest.';

export const GROUP_TARGET_DISCLOSURE =
  'Group targets pool contributions toward a shared goal and earn no interest. ' +
  'Funds are released by the agreed withdrawal rule.';

// Default auto-save frequency options (display only; backend owns the schedule).
export const FREQUENCIES = [
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;

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
