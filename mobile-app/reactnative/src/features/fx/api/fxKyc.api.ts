// ── FX Exchange — KYC/KYB API wrapper ────────────────────────────────────────
// Verification onboarding (spec A, §16). Mock-flagged; flip USE_MOCK=false once
// POST /v1/customers + verification endpoints land.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type { Verification, KycSubmission } from '../types/fx.types';

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_FX_USE_MOCK, true);
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
// Unwrap { data: ... } by key presence (see fx.api.ts) so an empty { data: null }
// yields null rather than the wrapper object.
const unwrap = <T>(res: { data: unknown }): T => {
  const body = res?.data;
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
};

// Module-level mock verification state (starts unverified).
let MOCK_VERIFICATION: Verification = {
  status: 'unstarted',
  accountType: 'individual',
  tier: 0,
};

export async function getVerification(): Promise<Verification> {
  if (USE_MOCK) { await delay(200); return { ...MOCK_VERIFICATION }; }
  try {
    const v = unwrap<Verification>(await api.get('/api/v1/fx/customers/verification'));
    // A user who has never started KYC has no record — treat empty as unstarted.
    return v ?? { status: 'unstarted', accountType: 'individual', tier: 0 };
  } catch (err) {
    // No verification record yet (404) → unstarted, so the screen shows the
    // "Verify your account" state instead of throwing.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return { status: 'unstarted', accountType: 'individual', tier: 0 };
    throw err;
  }
}

export async function submitKyc(submission: KycSubmission): Promise<Verification> {
  if (USE_MOCK) {
    await delay(1100);
    // Individuals auto-route to pending; businesses route to manual review.
    MOCK_VERIFICATION = {
      status: submission.accountType === 'business' ? 'review' : 'pending',
      accountType: submission.accountType,
      tier: 1,
      submittedAt: new Date().toISOString(),
    };
    return { ...MOCK_VERIFICATION };
  }
  return unwrap<Verification>(await api.post('/api/v1/fx/customers', submission));
}

/** Reset to allow a fresh submission after a rejection (spec A: resubmit). */
export async function restartKyc(): Promise<Verification> {
  if (USE_MOCK) {
    await delay(200);
    MOCK_VERIFICATION = { status: 'unstarted', accountType: MOCK_VERIFICATION.accountType, tier: 0 };
    return { ...MOCK_VERIFICATION };
  }
  return unwrap<Verification>(await api.post('/api/v1/fx/customers/verification/restart', {}));
}
