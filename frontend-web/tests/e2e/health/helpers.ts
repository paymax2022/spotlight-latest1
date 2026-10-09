/**
 * Shared helpers for the HEALTH-cluster E2E validation specs.
 *
 * The web product has no health UI (the member/provider surfaces live on
 * mobile), so every journey is exercised at the real Go API surface (:8080)
 * with admin actions driven by the admin fixture's GoTrue bearer — the same
 * RequireAuthContext + per-route RBAC chain the admin console proxy rides.
 *
 * Re-exports the proven cross/finance helper stack. Fixture-only mutations
 * (never product state): wallet funding posts the same balanced journal the
 * top-up webhook posts; kyc_tier is seeded because the local stack has no KYC
 * provider; a provider approval runs through the REAL admin decision route —
 * psql is only ever used to read (ledger sums, provider ids).
 */

import type { APIRequestContext } from '@playwright/test';

export {
  ADMIN_API_KEY,
  ADMIN_USER,
  ADMIN_WEB_URL,
  GO_BACKEND_URL,
  adminBearer,
  fundWallet,
  goTrueToken,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  setKycTier,
  setProfilePhone,
  standingAccountBalance,
  uniqueEmail,
  walletBalance,
  type LedgerLeg,
  type ProvisionedUser,
} from '../cross/helpers';

import { GO_BACKEND_URL, psql } from '../auth/helpers';
import { goTrueToken, ADMIN_USER } from '../provider/helpers';

/** Direct Go call with a bearer + arbitrary headers (Idempotency-Key etc.). */
export async function goFetch(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; token?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await request.fetch(`${GO_BACKEND_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/** Admin bearer for the /api/health admin RBAC groups (RequireAuthContext only — no x-admin-api-key). */
export async function healthAdminToken(request: APIRequestContext): Promise<string> {
  return goTrueToken(request, ADMIN_USER.email, ADMIN_USER.password);
}

let counter = 0;
/** Unique idempotency key per spec run — collisions would replay prior runs. */
export function idemKey(tag: string): string {
  counter += 1;
  return `e2e-hlt-${tag}-${Date.now()}-${counter}`;
}

/**
 * Drive the REAL provider-onboarding journey end-to-end:
 *   POST applications → POST credentials → POST submit → admin decision approve.
 * Returns the minted APPROVED health_providers id (application.provider_id).
 */
export async function onboardProvider(
  request: APIRequestContext,
  ownerToken: string,
  opts: { domain: 'PHARMACY' | 'LAB' | 'VET'; providerType: string; displayName: string },
): Promise<{ applicationId: string; providerId: string }> {
  const created = await goFetch(request, '/api/finance/health/providers/applications', {
    method: 'POST',
    token: ownerToken,
    data: {
      domain: opts.domain,
      provider_type: opts.providerType,
      display_name: opts.displayName,
    },
  });
  if (created.status !== 201) {
    throw new Error(`provider application failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const applicationId = created.body.application.id as string;

  const cred = await goFetch(request, `/api/finance/health/providers/applications/${applicationId}/credentials`, {
    method: 'POST',
    token: ownerToken,
    data: {
      cred_type: 'OTHER',
      reference_no: `E2E-${applicationId.slice(0, 8)}`,
      storage_key: `health/credentials/e2e-${applicationId}.pdf`,
    },
  });
  if (cred.status !== 201) {
    throw new Error(`credential add failed: ${cred.status} ${JSON.stringify(cred.body)}`);
  }

  const submitted = await goFetch(request, `/api/finance/health/providers/applications/${applicationId}/submit`, {
    method: 'POST',
    token: ownerToken,
  });
  if (submitted.status !== 200) {
    throw new Error(`application submit failed: ${submitted.status} ${JSON.stringify(submitted.body)}`);
  }

  const admin = await healthAdminToken(request);
  // Guarded SM: SUBMITTED → UNDER_REVIEW → APPROVED (no direct approve edge).
  const review = await goFetch(request, `/api/health/admin/providers/applications/${applicationId}/decision`, {
    method: 'POST',
    token: admin,
    data: { action: 'start_review', note: 'E2E sweep review' },
  });
  if (review.status !== 200) {
    throw new Error(`provider start_review failed: ${review.status} ${JSON.stringify(review.body)}`);
  }
  const decision = await goFetch(request, `/api/health/admin/providers/applications/${applicationId}/decision`, {
    method: 'POST',
    token: admin,
    data: { action: 'approve', note: 'E2E sweep approval' },
  });
  if (decision.status !== 200 || decision.body?.application?.state !== 'APPROVED') {
    throw new Error(`provider approve failed: ${decision.status} ${JSON.stringify(decision.body)}`);
  }
  const providerId = decision.body.application.provider_id as string;
  if (!providerId) throw new Error('approved application carried no provider_id');
  return { applicationId, providerId };
}

/** Read a provider row's status/discoverability (read-only fixture assertion). */
export function providerStatus(providerId: string): string {
  return psql(`select status || '|' || discoverable from health_providers where id='${providerId}';`);
}


