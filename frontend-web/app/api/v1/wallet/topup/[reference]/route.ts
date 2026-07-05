import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getTopupStatus } from '@/src/server/wallet/service';
import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';

// GET /api/v1/wallet/topup/:reference
// Returns the status of a wallet top-up intent so the app can wait for the
// Paystack webhook to credit the wallet before completing a module checkout
// ("pay with card" path). Scoped to the authenticated owner of the intent.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ reference: string }> },
) {
  if (!featureFlags.wallet()) return errorResponse('Wallet feature is not available.', 503);
  try {
    const user = await requireRequestUser(request);
    const { reference } = await ctx.params;
    const status = await getTopupStatus(reference, user.id);
    if (!status) return errorResponse('Top-up reference not found.', 404);

    return successResponse({
      success: true,
      reference: status.reference,
      status: status.status,
      completed: status.completed,
      amount_kobo: status.amountKobo,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
