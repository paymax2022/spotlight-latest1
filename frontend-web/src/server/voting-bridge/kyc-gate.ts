import { getKycProfile } from '@/src/server/kyc/service';
import { ApiError } from '@/src/lib/api/responses';

/**
 * Assert that a user's KYC status permits voting.
 *
 * Current rules (Block 6 scope — per-tier vote volume limits added in Block 7):
 *   - 'suspended': always denied (user flagged for fraud/compliance)
 *   - All other statuses: permitted (free votes don't require KYC tier 1)
 *
 * For paid votes via wallet, the wallet debit path enforces tier 1 separately
 * via requireKycTier(). This gate is specifically for the bridge layer.
 */
export async function assertKycGate(userId: string): Promise<void> {
  let profile;
  try {
    profile = await getKycProfile(userId);
  } catch {
    // Fail closed — if KYC check fails, deny the vote
    throw new ApiError('KYC verification check failed. Vote denied.', 403);
  }

  if (profile.kyc_status === 'suspended') {
    throw new ApiError('Your account has been suspended. Please contact support.', 403);
  }
}
