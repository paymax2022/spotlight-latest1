// ── Multi-provider KYC step-up — draft (save-as-you-go state) ────────────────
// A module singleton the step-up wizard reads/writes as the user progresses.
// Follows the fx/kyc `kycDraft` pattern: transient client-only form + the live
// server session id, kept out of React Query because it's in-flight UI state.
//
// The session id is persisted here so K14 (Resume) can pick the flow back up at
// the next incomplete step even if the user leaves and returns, and the passed
// captures (idNumber, captured selfie, etc.) survive back-navigation.

import type { CheckType, IdType, DocType, KycTier } from './types';

export interface KycVerifyDraft {
  /** Live server session id (persisted for resume). */
  sessionId: string | null;
  targetTier: KycTier;
  /** Consent recorded this attempt — gate for every check (K3). */
  consentGiven: boolean;

  // Identity (K4/K5)
  idType: IdType;
  idNumber: string;
  firstName: string;
  lastName: string;
  dob: string;

  // Biometrics (K7) — base64 stub captures for sandbox.
  selfieB64: string | null;

  // Document (K8) — base64 stub captures for sandbox.
  docType: DocType;
  docFrontB64: string | null;
  docBackB64: string | null;

  // Address (K10, Tier 3)
  addressLine: string;
  city: string;
  state: string;

  /** Checks the user has already completed with a terminal PASS this attempt. */
  passed: CheckType[];
}

function empty(): KycVerifyDraft {
  return {
    sessionId: null,
    targetTier: 1,
    consentGiven: false,
    idType: 'BVN',
    idNumber: '',
    firstName: '',
    lastName: '',
    dob: '',
    selfieB64: null,
    docType: 'NATIONAL_ID',
    docFrontB64: null,
    docBackB64: null,
    addressLine: '',
    city: '',
    state: '',
    passed: [],
  };
}

export const kycVerifyDraft: { current: KycVerifyDraft } = { current: empty() };

// Session-local granted tier from a completed step-up. In dev/mock the profile
// API tier isn't raised by the mock verify flow, so the step-up gate reads
// max(profileTier, kycGrant.tier) to avoid an infinite gate loop after the user
// has verified. It never LOWERS a tier, so it's a harmless no-op against a real
// backend (where the profile tier is authoritative).
export const kycGrant: { tier: KycTier } = { tier: 0 };
export function grantKycTier(tier: KycTier) {
  if (tier > kycGrant.tier) kycGrant.tier = tier;
}

/** Start a fresh attempt for a target tier (called on K1 → session start). */
export function resetKycVerifyDraft(targetTier: KycTier) {
  kycVerifyDraft.current = empty();
  kycVerifyDraft.current.targetTier = targetTier;
}

/** Mark a check as passed (save-as-you-go), de-duped. */
export function markPassed(check: CheckType) {
  const d = kycVerifyDraft.current;
  if (!d.passed.includes(check)) d.passed = [...d.passed, check];
}

/**
 * Deterministic base64 stub for a sandbox capture. Real Smile/Youverify SDK
 * output plugs in where this is called (see K7/K8 capture screens). The stub is
 * a valid, stable base64 string so the backend sandbox can accept + echo it.
 */
export function stubCaptureBase64(kind: string): string {
  // `data:` prefix omitted — backend expects raw base64. Deterministic per kind
  // so retried captures are idempotent-friendly and QA snapshots are stable.
  const payload = `PAYMAX-KYC-SANDBOX-${kind.toUpperCase()}`;
  // btoa is available in Hermes/RN; guard for older runtimes.
  const g = globalThis as unknown as { btoa?: (s: string) => string };
  if (typeof g.btoa === 'function') return g.btoa(payload);
  // Minimal fallback base64 encoder.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < payload.length; i += 3) {
    const b1 = payload.charCodeAt(i);
    const b2 = payload.charCodeAt(i + 1);
    const b3 = payload.charCodeAt(i + 2);
    out += chars[b1 >> 2];
    out += chars[((b1 & 3) << 4) | (b2 >> 4)];
    out += Number.isNaN(b2) ? '=' : chars[((b2 & 15) << 2) | (b3 >> 6)];
    out += Number.isNaN(b3) ? '=' : chars[b3 & 63];
  }
  return out;
}
