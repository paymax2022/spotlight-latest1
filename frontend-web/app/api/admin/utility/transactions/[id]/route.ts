import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminGetUtilityTransaction, listUtilityTransactionAttempts } from '@/src/server/utility/service';
import { requireUtilitySupport, utilityAdminUnavailableResponse } from '../../_utils';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    await requireUtilitySupport(request);
    const transaction = await adminGetUtilityTransaction(params.id);
    return successResponse({
      success: true,
      transaction,
      attempts: await listUtilityTransactionAttempts(transaction.id),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
