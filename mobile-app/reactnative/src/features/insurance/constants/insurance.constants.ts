// ── Insurance / "Protection" — Constants & module tokens ─────────────────────
// LIVE-first. The member surface (catalog, product detail, buy, policies,
// claims) talks to the real MyCover-backed endpoints through
// `src/features/insurance/live/*`, which has NO mock fallback at all.
//
// `USE_MOCK` now defaults to FALSE and survives only for the fixture-backed
// side surfaces that still have no live endpoint (agent, partner, embedded) and
// for the unit tests. It must never again decide what a real user is shown: a
// screen that silently serves invented data is worse than an error, because
// nobody goes looking for a bug they cannot see.

import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';
import type { KycTier, ProductLineGroup } from '../types';

export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_INSURANCE_USE_MOCK, false);

// Insurance REST namespace (frontend-web proxy → Go /api/finance/insurance/*).
export const INSURANCE_API_BASE = '/api/v1/insurance';

// Module-scoped colors built on the base design tokens (mirror ConnectColors —
// never hardcode hex). "Protection" leans on the teal/green growth palette.
export const InsuranceColors = {
  brand:    Colors.primary,
  accent:   Colors.secondary,
  ok:       Colors.teal,
  okBg:     Colors.iconBgTeal,
  warn:     Colors.gold,
  warnText: Colors.onWarning,
  danger:   Colors.error,
  dangerBg: Colors.errorContainer,
  surface:  Colors.surfaceContainerLowest,
  surfaceAlt: Colors.surfaceContainerLow,
  text:     Colors.onSurface,
  muted:    Colors.onSurfaceVariant,
  border:   Colors.outlineVariant,
  // Provider tints (used by UnderwriterBadge / ProductCard).
  mycover:    Colors.secondary,
  mycoverBg:  Colors.iconBgBlue,
  octamile:   Colors.teal,
  octamileBg: Colors.iconBgTeal,
} as const;

// ── Money helper ──────────────────────────────────────────────────────────────
// All amounts are kobo (minor units). Render with this; never divide inline.
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

/**
 * Compact ₦ for tight stat cells (e.g. hub "Total cover"), so a large sum like
 * ₦11,500,000 renders as "₦11.5M" instead of truncating to "₦11,500…".
 */
export function formatNairaCompact(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  if (naira >= 1_000_000) return '₦' + (naira / 1_000_000).toFixed(naira % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (naira >= 10_000) return '₦' + (naira / 1_000).toFixed(naira % 1_000 === 0 ? 0 : 1) + 'k';
  return '₦' + naira.toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

/** Cadence → human suffix on a premium row (e.g. "₦1,200 / mo"). */
export const CADENCE_SUFFIX: Record<string, string> = {
  'one-off': '',
  monthly: ' / mo',
  annual: ' / yr',
  'per-shipment': ' / shipment',
  'per-trip': ' / trip',
};

// ── KYC tier ordering (for the KYC-gap gate; PRD §16/§24 KYC_TIER_INSUFFICIENT)──
export const TIER_RANK: Record<KycTier, number> = {
  TIER_0: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
};

export const TIER_LABEL: Record<KycTier, string> = {
  TIER_0: 'Tier 0',
  TIER_1: 'Tier 1',
  TIER_2: 'Tier 2',
  TIER_3: 'Tier 3',
};

export const TIER_REQUIREMENT: Record<KycTier, string> = {
  TIER_0: 'Phone + name',
  TIER_1: 'BVN or NIN linked',
  TIER_2: 'BVN + NIN + photo ID + proof of address',
  TIER_3: 'Tier 2 + liveness + enhanced due diligence',
};

// ── NDPA consent (PRD §18) ──────────────────────────────────────────────────
export const CONSENT_VERSION = 'ndpa-2023-v1';

/** Product-line browse groups for the Protection hub + browse screen. */
export const PRODUCT_LINES: ProductLineGroup[] = [
  { line: 'HEALTH',            label: 'Health & HMO',      description: 'Micro-health and hospital cover', icon: 'HeartPulse',   provider: 'MYCOVER' },
  { line: 'PERSONAL_ACCIDENT', label: 'Personal Accident', description: 'Income & injury protection',      icon: 'ShieldPlus',   provider: 'MYCOVER' },
  { line: 'DEVICE',            label: 'Device & Gadget',   description: 'Phone, laptop & gadget cover',    icon: 'Smartphone',   provider: 'MYCOVER' },
  { line: 'SME',               label: 'SME & Business',    description: 'Cover for your small business',   icon: 'Building2',    provider: 'MYCOVER' },
  { line: 'MOTOR',             label: 'Motor & Vehicle',   description: 'Third-party & comprehensive',     icon: 'Car',          provider: 'OCTAMILE' },
  { line: 'GOODS_IN_TRANSIT',  label: 'Goods-in-Transit',  description: 'Protect parcels & freight',       icon: 'Truck',        provider: 'OCTAMILE' },
];

export const PRODUCT_LINE_LABEL: Record<string, string> = Object.fromEntries(
  PRODUCT_LINES.map((l) => [l.line, l.label]),
);

/** Friendly labels for policy states (used by StateChip). */
export const POLICY_STATE_LABEL: Record<string, string> = {
  QUOTED: 'Quoted',
  PENDING_PAYMENT: 'Awaiting payment',
  BINDING: 'Activating',
  ACTIVE: 'Active',
  RENEWAL_DUE: 'Renewal due',
  LAPSED: 'Lapsed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  BIND_FAILED: 'Failed',
  VOID: 'Void',
};

/** Simulated network latency so loading states render in mock mode. */
export const MOCK_DELAY_MS = 360;
