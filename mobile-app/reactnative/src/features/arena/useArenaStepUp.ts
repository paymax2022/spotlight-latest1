// ── Arena — reusable KYC step-up guard ───────────────────────────────────────
// Drop this in front of any sensitive Arena action (apply as contestant, Back-a-
// Driver support, live gifting). It REUSES the kyc-verify step-up: it reads the
// user's current KYC tier and, if below `requiredTier`, routes into the existing
// kyc-verify flow for that tier, then the caller can resume. We do NOT rebuild KYC.
//
//   const stepUp = useArenaStepUp(1);
//   const onSupport = async () => { if (!(await stepUp.ensure())) return; openSheet(); };
//
// Thin wrapper over the shared useKycStepUp so Arena screens don't reach into the
// kycverify module directly and future Arena-specific gating (wallet balance,
// competition-required tier) lands in one place.

import { useKycStepUp, type KycStepUp } from '@/features/kycverify/useKycStepUp';
import type { KycTier } from '@/features/kycverify/types';

export type ArenaStepUpTier = Exclude<KycTier, 0>;

export interface ArenaStepUp extends KycStepUp {}

/**
 * @param requiredTier the KYC tier the sensitive action needs (default 1).
 * A competition can require a higher tier to apply; pass `competition.requiredKycTier`.
 */
export function useArenaStepUp(requiredTier: ArenaStepUpTier = 1): ArenaStepUp {
  return useKycStepUp(requiredTier);
}
