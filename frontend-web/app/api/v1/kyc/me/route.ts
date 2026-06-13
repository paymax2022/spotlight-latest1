/**
 * GET /api/v1/kyc/me
 * Returns the authenticated user's KYC tier and status.
 * Spec: contracts/openapi.yaml#/paths/~1kyc~1me
 */
import { handleApiError, successResponse, errorResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getKycProfile } from '@/src/server/kyc/service';
import { featureFlags } from '@/src/lib/feature-flags';

export async function GET(request: Request) {
  try {
    if (!featureFlags.kyc()) return errorResponse('KYC feature is not available', 503);

    const user = await requireRequestUser(request);
    const profile = await getKycProfile(user.id);

    return successResponse({
      success: true,
      kyc_tier:        profile.kyc_tier,
      kyc_status:      profile.kyc_status,
      phone_verified:  profile.phone_verified,
      submitted_at:    profile.kyc_submitted_at,
      verified_at:     profile.kyc_verified_at,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to fetch KYC status');
  }
}
