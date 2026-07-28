/**
 * POST /api/v1/kyc/tier0
 * Auto-verify Tier 0 when a user has email + date_of_birth + phone.
 * No document submission required. Idempotent — returns 200 if already Tier 0 verified.
 */
import { handleApiError, successResponse, errorResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { claimTier0 } from '@/src/server/kyc/service';
import { featureFlags } from '@/src/lib/feature-flags';

export async function POST(request: Request) {
  try {
    if (!featureFlags.kyc()) return errorResponse('KYC feature is not available', 503);

    const user = await requireRequestUser(request);
    const profile = await claimTier0(user.id);

    return successResponse({
      success:     true,
      kyc_tier:    profile.kyc_tier,
      kyc_status:  profile.kyc_status,
      verified_at: profile.kyc_verified_at,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to claim Tier 0');
  }
}
