import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { getBalance } from '@/src/server/wallet/service';
import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';

export async function GET(request: Request) {
  if (!featureFlags.wallet()) return errorResponse('Wallet feature is not available.', 503);

  try {
    const user = await requireRequestUser(request);
    await requireKycTier(user.id, 1);

    const balance = await getBalance(user.id);

    return successResponse({
      success: true,
      available_kobo: balance.available_kobo,
      currency: balance.currency,
      account_id: balance.account_id,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
