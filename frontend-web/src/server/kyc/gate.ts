/**
 * KYC tier gate — used by wallet, vote-bridge, and virtual-account services.
 *
 * Call `requireKycTier(userId, 1)` at the top of any endpoint that needs
 * at least Tier 1. Throws ApiError(403) fail-closed on any DB error.
 */

import { ApiError } from '@/src/lib/api/responses';
import { getKycTier } from './service';
import type { KycTier } from './types';

/**
 * Throws ApiError(403) if the user's KYC tier is below `required`.
 * Fails closed: if the DB call errors, access is denied.
 */
export async function requireKycTier(userId: string, required: KycTier): Promise<void> {
  let tier: KycTier;
  try {
    tier = await getKycTier(userId);
  } catch {
    // Fail closed — unknown tier = deny
    throw new ApiError(
      'KYC verification check failed. Access denied.',
      403,
    );
  }

  if (tier < required) {
    throw new ApiError(
      `This feature requires KYC Tier ${required}. Your current tier is ${tier}. ` +
      `Please complete identity verification to continue.`,
      403,
    );
  }
}
