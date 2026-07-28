// ── K15 — reusable step-up gate ──────────────────────────────────────────────
// Drop this in front of any sensitive action (large transfer, card issue, etc.).
// It reads the user's current KYC tier and, if it's below `requiredTier`, routes
// into the kyc-verify flow targeting exactly that tier. Otherwise `ensure()`
// resolves true and the caller proceeds.
//
//   const stepUp = useKycStepUp(2);
//   const onSend = async () => { if (!(await stepUp.ensure())) return; doSend(); };

import { useCallback } from 'react';
import { router, usePathname, useGlobalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getKycProfile } from '@/api/kyc.api';
import { rememberResume, toParamMap, type ResumeTarget } from '@/lib/resume';
import { kycGrant } from './draft';
import type { KycTier } from './types';

export interface KycStepUp {
  /** Current verified tier (0 if unknown/unverified). */
  currentTier: KycTier;
  /** True when the user already meets the required tier. */
  satisfied: boolean;
  isLoading: boolean;
  /**
   * Returns true if the user meets `requiredTier` (caller may proceed);
   * otherwise navigates into kyc-verify for the required tier and returns false.
   */
  ensure: () => Promise<boolean>;
  /**
   * Imperatively open the step-up flow for the required tier. Pass a `resume`
   * target to return there (and re-open the action) once verified; if omitted,
   * the current screen is remembered automatically.
   */
  open: (resume?: ResumeTarget) => void;
}

export function useKycStepUp(requiredTier: Exclude<KycTier, 0>): KycStepUp {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['kyc', 'me'],
    queryFn: getKycProfile,
    staleTime: 30_000,
  });
  const pathname = usePathname();
  const globalParams = useGlobalSearchParams();

  // Honour a session-local grant from a just-completed step-up (so dev/mock,
  // where the profile tier isn't raised, doesn't loop). Never lowers the tier.
  const currentTier = Math.max((data?.tier ?? 0), kycGrant.tier) as KycTier;
  const satisfied = currentTier >= requiredTier;

  const open = useCallback((resume?: ResumeTarget) => {
    // Remember where to resume: an explicit target (to re-open an action), else
    // the screen the user is on right now.
    rememberResume(resume ?? { pathname, params: toParamMap(globalParams) });
    router.push({
      pathname: '/kyc-verify',
      params: { target: String(requiredTier), stepUp: '1' },
    });
  }, [requiredTier, pathname, globalParams]);

  const ensure = useCallback(async () => {
    // Re-check against the freshest tier (overlaid with any session grant) before
    // gating a sensitive action.
    const fresh = await refetch();
    const tier = Math.max((fresh.data?.tier ?? 0), kycGrant.tier) as KycTier;
    if (tier >= requiredTier) return true;
    open();
    return false;
  }, [refetch, requiredTier, open]);

  return { currentTier, satisfied, isLoading, ensure, open };
}
