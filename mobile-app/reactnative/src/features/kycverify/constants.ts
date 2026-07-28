// ── Multi-provider KYC step-up — tier requirements & labels ──────────────────
// Single source of truth for "what a target tier needs". Screens derive the
// checklist (K2), the ordered wizard steps (K14 resume), and the human labels
// from here so we ask ONLY for the target tier's required checks (UX rule).

import type { CheckType, IdType, DocType, KycTier } from './types';

export const CONSENT_VERSION = '2026-07-ndpa-cbn-v1';

// Dev/offline mode: when true (the default), the KYC api returns deterministic
// results without a backend so the flow is walkable in dev. Set
// EXPO_PUBLIC_KYC_VERIFY_USE_MOCK=false once the Go /api/finance/kyc backend is
// live to hit the real multi-provider gateway.
export const USE_MOCK = (process.env.EXPO_PUBLIC_KYC_VERIFY_USE_MOCK ?? 'true') !== 'false';

/** Ordered checks required to reach each tier. Data-only first, biometrics/doc after. */
export const TIER_REQUIREMENTS: Record<Exclude<KycTier, 0>, CheckType[]> = {
  1: ['id-number'],
  2: ['id-number', 'liveness', 'facial'],
  3: ['id-number', 'liveness', 'facial', 'document', 'aml'],
};

/** Plain-language checklist copy shown on K2 (Tier requirements). */
export const TIER_REQUIREMENT_COPY: Record<Exclude<KycTier, 0>, string[]> = {
  1: ['Your BVN or NIN (data match)'],
  2: ['Your BVN or NIN (data match)', 'A quick selfie', 'A liveness check'],
  3: [
    'Your BVN or NIN (data match)',
    'A quick selfie',
    'A liveness check',
    'A photo of a government ID document',
    'Your residential address (AML / EDD screening)',
  ],
};

/** Approximate spend limits unlocked at each tier (kobo → display strings). */
export const TIER_LIMITS: Record<KycTier, { daily: string; balance: string }> = {
  0: { daily: '—',          balance: 'Send/receive locked' },
  1: { daily: '₦50,000',    balance: '₦300,000 max balance' },
  2: { daily: '₦500,000',   balance: '₦2,000,000 max balance' },
  3: { daily: '₦5,000,000', balance: 'Unlimited balance' },
};

export const TIER_LABELS: Record<KycTier, string> = {
  0: 'Unverified',
  1: 'Tier 1',
  2: 'Tier 2',
  3: 'Tier 3',
};

/** ID types usable for the data-match / facial check (Tier 1+). */
export const ID_TYPES: { value: IdType; label: string }[] = [
  { value: 'BVN',             label: 'Bank Verification Number (BVN)' },
  { value: 'NIN',             label: 'National Identity Number (NIN)' },
  { value: 'PASSPORT',        label: 'International Passport' },
  { value: 'DRIVERS_LICENSE', label: "Driver's Licence" },
];

/** Document types for the front/back capture (Tier 3). */
export const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'NATIONAL_ID',     label: 'National ID Card' },
  { value: 'PASSPORT',        label: 'International Passport' },
  { value: 'DRIVERS_LICENSE', label: "Driver's Licence" },
  { value: 'VOTERS_CARD',     label: "Voter's Card" },
];

/** Whether a given ID type needs a "why we need this" BVN/NIN-length hint. */
export const ID_NUMBER_HELP: Record<IdType, { placeholder: string; why: string; length?: number }> = {
  BVN: {
    placeholder: '11-digit BVN',
    why: 'Your BVN lets us confirm your identity against bank records. We never see your bank balance or transactions.',
    length: 11,
  },
  NIN: {
    placeholder: '11-digit NIN',
    why: 'Your NIN is matched against the national identity database to confirm your name and date of birth.',
    length: 11,
  },
  PASSPORT: {
    placeholder: 'Passport number',
    why: 'We match your passport number against government records to confirm your identity.',
  },
  DRIVERS_LICENSE: {
    placeholder: 'Licence number',
    why: "We match your driver's licence against government records to confirm your identity.",
  },
  VOTERS_CARD: {
    placeholder: 'VIN',
    why: "We match your voter's card against INEC records to confirm your identity.",
  },
};

/** The next tier a user can step up to from their current tier. */
export function nextTier(current: KycTier): Exclude<KycTier, 0> | null {
  if (current >= 3) return null;
  return (current + 1) as Exclude<KycTier, 0>;
}
