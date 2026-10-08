import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { getUserUtilityTransaction, listUtilityTransactionAttempts } from '@/src/server/utility/service';
import { requireUtilityUser, utilityGoProxyEnabled, utilityUnavailableResponse } from '../../_utils';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);

    if (utilityGoProxyEnabled()) {
      // Proxy to Go backend to get transaction details
      const upstream = await proxyToGoBackend(request, `/api/finance/utilitybills/transactions/${params.id}`);
      if (upstream.status >= 400) return upstream;
      const data = await upstream.json() as Record<string, unknown>;

      // Also fetch attempts from the separate Go endpoint
      const attemptsUpstream = await proxyToGoBackend(
        request,
        `/api/finance/utilitybills/transactions/${params.id}/attempts`,
      );
      let attempts: unknown[] = [];
      if (attemptsUpstream.status < 400) {
        const attemptsData = await attemptsUpstream.json() as Record<string, unknown>;
        if (Array.isArray(attemptsData.attempts)) attempts = attemptsData.attempts;
      }
      return successResponse({ success: true, transaction: data.transaction, attempts });
    }

    // Every transaction pay/validate/paystack-verify call in this module writes
    // to the LOCAL Supabase-native store (src/server/utility/service.ts), not
    // the Go backend's separate utilitybills module — this route unconditionally
    // proxied to Go regardless, so it could never find a transaction created
    // through the path every other route in this file actually uses. A customer
    // polling this endpoint after paying by card got either a 404 or a payload
    // shaped nothing like what this app writes, so the status page never left
    // "processing" even after the provider (and Paystack) had genuinely
    // completed the payment. The receipt route (../receipt/route.ts) already
    // reads the correct store — this brings the detail route in line with it.
    const transaction = await getUserUtilityTransaction(user.id, params.id);
    const attempts = await listUtilityTransactionAttempts(transaction.id);
    return successResponse({ success: true, transaction, attempts });
  } catch (err) {
    return handleApiError(err);
  }
}
