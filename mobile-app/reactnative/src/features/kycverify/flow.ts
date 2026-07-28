// ── Multi-provider KYC step-up — flow routing (K14 resume) ───────────────────
// Given the current draft + target tier requirements, decide the next screen.
// Used both for forward navigation after each PASS and for K14 "Resume KYC",
// which returns the user to the next incomplete step.

import { TIER_REQUIREMENTS } from './constants';
import type { KycVerifyDraft } from './draft';
import type { CheckType, KycTier } from './types';

const CHECK_ROUTE: Record<CheckType, string> = {
  'id-number': '/kyc-verify/id-type',
  liveness: '/kyc-verify/selfie',
  facial: '/kyc-verify/selfie', // facial is captured together with the selfie/liveness step
  document: '/kyc-verify/document',
  aml: '/kyc-verify/address',
};

/**
 * The next incomplete check for the target tier, or null when all are done.
 * Data-only (id-number) → biometrics (liveness/facial) → document → aml, in the
 * TIER_REQUIREMENTS order. `facial` shares the selfie step with `liveness`.
 */
export function nextIncompleteCheck(draft: KycVerifyDraft): CheckType | null {
  const required = TIER_REQUIREMENTS[draft.targetTier as Exclude<KycTier, 0>] ?? [];
  for (const check of required) {
    if (!draft.passed.includes(check)) return check;
  }
  return null;
}

/** Resolve the route for the next incomplete step (expo-router path string). */
export function nextStepRoute(draft: KycVerifyDraft): string {
  const next = nextIncompleteCheck(draft);
  if (!next) return '/kyc-verify/pending';
  return CHECK_ROUTE[next];
}
