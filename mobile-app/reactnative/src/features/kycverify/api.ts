// Talks to the Go backend at EXPO_PUBLIC_API_BASE_URL → /api/finance/kyc via the
// shared axios `api` client (bearer auth injected by the request interceptor).
// Iron rule: every check POST carries a fresh Idempotency-Key header so a retried
// SDK capture flows use the server-issued token from /sdk-token.

import { api } from '@/api/client';
import { USE_MOCK } from './constants';
import { idNumberRequestBody, type IdNumberCheckInput } from './idNumberRequest';
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
 * Map the Go backend's snake_case Check to our camelCase VerificationCheck.
 * The id-number data-match echoes the provider-verified name/DOB as
 * matched_name/matched_dob so the UI can DISPLAY them and the user's Continue
 * affirms the returned value.
 */
function toVerificationCheck(raw: any, fallbackType: CheckType): VerificationCheck {
  // The backend enum is "ID_NUMBER"/"ID_FACIAL"/…; the mobile CheckType is
  // route-slug style. Map, falling back to the caller's expectation.
  const typeMap: Record<string, CheckType> = {
    ID_NUMBER: 'id-number',
    ID_FACIAL: 'facial',
    LIVENESS: 'liveness',
    DOCUMENT: 'document',
    AML: 'aml',
  };
  return {
    id: raw?.id ?? '',
    type: typeMap[raw?.type] ?? fallbackType,
    status: raw?.status as CheckStatus,
    reason: raw?.reason ?? null,
    matchedName: raw?.matched_name ?? null,
    matchedDob: raw?.matched_dob ?? null,
    provider: raw?.provider ?? null,
    createdAt: raw?.created_at ?? null,
  };
}

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

/** POST /consent — record explicit NDPA/CBN consent for a scope + version. */
export async function postConsent(scope: ConsentScope, version: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await mockDelay(250);
    return { ok: true };
  }
  await api.post(`${BASE}/consent`, { scope, version });
  return { ok: true };
}

// IdNumberCheckInput is defined in the alias-free ./idNumberRequest module (so
// the request shape is unit-testable without the axios client) and re-exported
// here for callers that import it from the api surface.
export type { IdNumberCheckInput };

/**
 * POST /checks/id-number — data match against government records. The request
 * carries ONLY the session + ID number: the provider (Dojah) returns the
 * verified legal name + DOB, which the backend echoes back as matched_name/
 * matched_dob for the user to AFFIRM, and persists server-side. The client
 * never collects or sends the name/DOB itself.
 */
export async function checkIdNumber(input: IdNumberCheckInput): Promise<VerificationCheck> {
  if (USE_MOCK) {
    await mockDelay();
    // Mirror the real backend now that it echoes the matched identity: return a
    // deterministic name/DOB so the verifying screen shows the value the user
    // affirms by continuing.
    return mockPassedCheck('id-number', { name: 'Amara Okonkwo', dob: '1992-07-14' });
  }
  return toVerificationCheck(
    unwrap<any>(await api.post(`${BASE}/checks/id-number`, idNumberRequestBody(input), idem())),
    'id-number',
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
  return toVerificationCheck(
    unwrap<any>(
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
    ),
    'facial',
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
  return toVerificationCheck(
    unwrap<any>(
      await api.post(
        `${BASE}/checks/liveness`,
        { session_id: input.sessionId, selfie_b64: input.selfieB64 },
        idem(),
      ),
    ),
    'liveness',
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
  return toVerificationCheck(
    unwrap<any>(
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
    ),
    'document',
  );
}

/** POST /checks/aml — AML / sanctions / address screening (Tier 3 EDD). */
export async function checkAml(sessionId: string): Promise<VerificationCheck> {
  if (USE_MOCK) {
    await mockDelay();
    return mockPassedCheck('aml');
  }
  return toVerificationCheck(
    unwrap<any>(await api.post(`${BASE}/checks/aml`, { session_id: sessionId }, idem())),
    'aml',
  );
}

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
