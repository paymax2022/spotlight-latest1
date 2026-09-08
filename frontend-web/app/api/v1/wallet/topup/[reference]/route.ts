import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getTopupStatus } from '@/src/server/wallet/service';
import { verifyAndSettleTopup } from '@/src/server/wallet/verify';
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
    let status = await getTopupStatus(reference, user.id);
    if (!status) return errorResponse('Top-up reference not found.', 404);

    // A webhook is best-effort: it can be delayed, dropped, or (in local
    // development, where api.paystack.co cannot reach localhost) never arrive at
    // all. The customer has paid regardless, and the checkout waiting on this
    // endpoint would otherwise poll until it times out.
    //
    // So a still-pending intent is resolved against Paystack, which is the
    // authority. verifyAndSettleTopup enforces ownership, credits only on a
    // confirmed success for the exact amount, and shares its settlement — and
    // therefore its ledger idempotency key — with the webhook, so the two racing
    // the same payment credit it once.
    if (!status.completed) {
      const verified = await verifyAndSettleTopup(reference, user.id);
      if (verified.settled) {
        status = (await getTopupStatus(reference, user.id)) ?? status;
      }
    }

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
