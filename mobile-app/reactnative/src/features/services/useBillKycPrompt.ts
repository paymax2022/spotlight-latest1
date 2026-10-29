// Bill payments above ₦20,000 from an unverified (Tier 0) wallet are refused by the
// server with a KYC 403. Instead of showing that as a failure, explain it and offer
// to start Tier 1 verification right away, returning here once it is done.

import { useCallback } from 'react';
import { kycTierRequired } from '@/api/kycGate';
import { confirmAsync } from '@/lib/confirm';
import { useKycStepUp } from '@/features/kycverify/useKycStepUp';

/**
 * Returns a handler for a failed bill payment. Resolves `true` when the error was
 * the KYC gate (the user has been prompted; show no further error), `false` when
 * it was anything else (show it as usual).
 */
export function useBillKycPrompt(): (error: unknown) => Promise<boolean> {
  const stepUp = useKycStepUp(1);
  return useCallback(async (error: unknown) => {
    if (!kycTierRequired(error)) return false;
    const proceed = await confirmAsync({
      title: 'Verify your identity to continue',
      message:
        'Bill payments above ₦20,000 need at least Tier 1 verification. ' +
        'It only takes a few minutes: we confirm your details with our verification partner, Dojah. ' +
        'Would you like to verify now?',
      confirmLabel: 'Verify now',
      cancelLabel: 'Not now',
    });
    if (proceed) stepUp.open();
    return true;
  }, [stepUp]);
}
