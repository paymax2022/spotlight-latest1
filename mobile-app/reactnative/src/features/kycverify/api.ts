// ── Multi-provider KYC step-up — API wrapper ─────────────────────────────────
// Talks to the Go backend at EXPO_PUBLIC_API_BASE_URL → /api/finance/kyc via the
// shared axios `api` client (bearer auth injected by the request interceptor).
//
// Iron rule: every check POST carries a fresh Idempotency-Key header so a retried
// capture never double-runs a provider check. No provider secret lives in the app;
// SDK capture flows use the server-issued token from /sdk-token.

import { api } from '@/api/client';
import { USE_MOCK } from './constants';
import type {
  VerificationSession,
  VerificationCheck,
  SdkToken,
  CheckStatus,
  SessionStatus,
  CheckType,
  IdType,
  DocType,
  KycTier,
  ConsentScope,
} from './types';

const BASE = '/api/finance/kyc';

// ─── Mock/offline mode (dev; no backend) ────────────────────────────────────
// Deterministic PASSED results so the whole step-up flow is walkable without the
// Go gateway. Flip EXPO_PUBLIC_KYC_VERIFY_USE_MOCK=false for the real backend.
const mockDelay = (ms = 900) => new Promise((r) => setTimeout(r, ms));

function mockPassedCheck(type: CheckType, opts?: { name?: string; dob?: string }): VerificationCheck {
  return {
    id: `chk_${type}_${Date.now()}`,
    type,
    status: 'PASSED',
    reason: null,
    matchedName: opts?.name ?? null,
    matchedDob: opts?.dob ?? null,
    provider: 'dojah',
    createdAt: new Date().toISOString(),
  };
}

/** Unwrap the common { data } envelope used across the backend. */
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

/**
 * Fresh Idempotency-Key per check attempt. Uses crypto.randomUUID where
 * available (RN 0.71+ / Hermes), falling back to a timestamp+random uuid-v4-ish
 * string so the header is always present even on older runtimes.
 */
export function newIdempotencyKey(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  // RFC-4122-ish v4 fallback (non-crypto; fine for an idempotency token).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const idem = () => ({ headers: { 'Idempotency-Key': newIdempotencyKey() } });

// ─── Session ──────────────────────────────────────────────────────────────

/** POST /session — start a step-up session for a target tier. */
export async function createSession(targetTier: KycTier): Promise<VerificationSession> {
  if (USE_MOCK) {
    await mockDelay(400);
    return { id: `vs_${Date.now()}`, status: 'TIER_PENDING', targetTier };
  }
  return unwrap<VerificationSession>(
    await api.post(`${BASE}/session`, { target_tier: targetTier }),
  );
}

/** GET /session/{id} — session + its checks (used for polling K11 → K12/K13). */
export async function getSession(id: string): Promise<VerificationSession> {
  if (USE_MOCK) {
    await mockDelay(400);
    return { id, status: 'TIER_VERIFIED', targetTier: 1, checks: [] };
  }
  return unwrap<VerificationSession>(await api.get(`${BASE}/session/${id}`));
}

// ─── Consent (MUST run before any check) ────────────────────────────────────

/** POST /consent — record explicit NDPA/CBN consent for a scope + version. */
export async function postConsent(scope: ConsentScope, version: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await mockDelay(250);
    return { ok: true };
  }
  await api.post(`${BASE}/consent`, { scope, version });
  return { ok: true };
}

// ─── Checks (each carries an Idempotency-Key) ───────────────────────────────

export interface IdNumberCheckInput {
  sessionId: string;
  idType: IdType;
  idNumber: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
}

/** POST /checks/id-number — data match against government records. */
export async function checkIdNumber(input: IdNumberCheckInput): Promise<VerificationCheck> {
  if (USE_MOCK) {
    await mockDelay();
    const name = [input.firstName, input.lastName].filter(Boolean).join(' ') || 'Verified Holder';
    return mockPassedCheck('id-number', { name, dob: input.dob ?? '1990-01-01' });
  }
  return unwrap<VerificationCheck>(
    await api.post(
      `${BASE}/checks/id-number`,
      {
        session_id: input.sessionId,
        id_type: input.idType,
        id_number: input.idNumber,
        first_name: input.firstName,
        last_name: input.lastName,
        dob: input.dob,
      },
      idem(),
    ),
  );
}

/** POST /checks/facial — face match between selfie and ID photo. */
export async function checkFacial(input: {
  sessionId: string;
  idType: IdType;
  idNumber: string;
  selfieB64: string;
}): Promise<VerificationCheck> {
  if (USE_MOCK) {
    await mockDelay();
    return mockPassedCheck('facial');
  }
  return unwrap<VerificationCheck>(
    await api.post(
      `${BASE}/checks/facial`,
      {
        session_id: input.sessionId,
        id_type: input.idType,
        id_number: input.idNumber,
        selfie_b64: input.selfieB64,
      },
      idem(),
    ),
  );
}

/** POST /checks/liveness — anti-spoof liveness on a captured selfie. */
export async function checkLiveness(input: {
  sessionId: string;
  selfieB64: string;
}): Promise<VerificationCheck> {
  if (USE_MOCK) {
    await mockDelay();
    return mockPassedCheck('liveness');
  }
  return unwrap<VerificationCheck>(
    await api.post(
      `${BASE}/checks/liveness`,
      { session_id: input.sessionId, selfie_b64: input.selfieB64 },
      idem(),
    ),
  );
}

/** POST /checks/document — OCR + authenticity on a captured ID document. */
export async function checkDocument(input: {
  sessionId: string;
  docType: DocType;
  frontB64: string;
  backB64?: string;
}): Promise<VerificationCheck> {
  if (USE_MOCK) {
    await mockDelay();
    return mockPassedCheck('document');
  }
  return unwrap<VerificationCheck>(
    await api.post(
      `${BASE}/checks/document`,
      {
        session_id: input.sessionId,
        doc_type: input.docType,
        front_b64: input.frontB64,
        back_b64: input.backB64,
      },
      idem(),
    ),
  );
}

/** POST /checks/aml — AML / sanctions / address screening (Tier 3 EDD). */
export async function checkAml(sessionId: string): Promise<VerificationCheck> {
  if (USE_MOCK) {
    await mockDelay();
    return mockPassedCheck('aml');
  }
  return unwrap<VerificationCheck>(
    await api.post(`${BASE}/checks/aml`, { session_id: sessionId }, idem()),
  );
}

// ─── SDK token (server-issued; no provider secret in the app) ───────────────

/** POST /sdk-token — short-lived token for embedding a provider capture SDK. */
export async function getSdkToken(provider: string): Promise<SdkToken> {
  if (USE_MOCK) {
    await mockDelay(200);
    return { token: `mock-${provider}-token`, expiresAt: new Date(Date.now() + 600_000).toISOString(), provider };
  }
  const raw = unwrap<{ token: string; expires_at: string }>(
    await api.post(`${BASE}/sdk-token`, { provider }),
  );
  return { token: raw.token, expiresAt: raw.expires_at, provider };
}

// ─── Terminal-state helpers (shared branching logic) ────────────────────────

export const CHECK_TERMINAL: CheckStatus[] = ['PASSED', 'FAILED', 'REVIEW'];
export const SESSION_TERMINAL: SessionStatus[] = [
  'TIER_VERIFIED',
  'APPROVED',
  'TIER_FAILED',
  'REJECTED',
];

export function isSessionSettled(status: SessionStatus): boolean {
  return SESSION_TERMINAL.includes(status);
}

export function isSessionReview(status: SessionStatus): boolean {
  return status === 'NEEDS_REVIEW' || status === 'TIER_PENDING';
}
