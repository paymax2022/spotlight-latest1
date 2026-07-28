import { Colors } from '@/constants/colors';

// Flip to false once live /api/v1/social endpoints are reachable
// (or set EXPO_PUBLIC_SOCIAL_USE_MOCK=false). Mock-first convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_SOCIAL_USE_MOCK ?? 'true') !== 'false';

// Social Pay REST namespace. Served directly by the Go backend (Gin) under the
// authenticated finance member group — NOT the frontend-web /api/v1 proxy.
// Confirmed against backend/internal/app/top5_p1_routes.go (RegisterSocialPay
// mounts finance.Group("/social")) + backend/internal/social/handler.go Register.
export const API_BASE = '/api/finance/social';

// Module-scoped colors built on the base design tokens (never hardcode hex).
export const SocialColors = {
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

// ── AML / KYC limit messaging (NL-10) ────────────────────────────────────────
// Display-only mirror of backend-owned velocity limits. The server is the source
// of truth; copy here keeps the UX honest about why a transfer may be blocked.
export const AML_DAILY_LIMIT_KOBO = 50_000_000; // ₦500,000 Tier-2 daily ceiling

export const AML_LIMIT_NOTICE =
  'Send limits keep Paymax safe (anti-money-laundering rules). Your daily limit ' +
  'depends on your KYC tier — upgrade your tier to raise it.';

export function amlMessageFor(amountKobo: number, remainingKobo: number): string | null {
  if (amountKobo > remainingKobo) {
    return `This exceeds your remaining daily limit of ${formatNaira(remainingKobo)}. Upgrade your KYC tier to send more.`;
  }
  return null;
}

// Cashtag handle rules (display + light client validation; server resolves).
export const CASHTAG_PREFIX = '@';
export const CASHTAG_REGEX = /^@?[a-zA-Z0-9_]{3,20}$/;

export function normalizeHandle(input: string): string {
  const trimmed = input.trim().replace(/^@+/, '');
  return CASHTAG_PREFIX + trimmed.toLowerCase();
}

// Money formatting — kobo (minor units) → ₦ string.
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
