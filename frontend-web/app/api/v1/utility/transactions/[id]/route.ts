import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { getUserUtilityTransaction, listUtilityTransactionAttempts } from '@/src/server/utility/service';
import { requireUtilityUser, utilityUnavailableResponse } from '../../_utils';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const transaction = await getUserUtilityTransaction(user.id, params.id);
    return successResponse({
      success: true,
      transaction,
      attempts: await listUtilityTransactionAttempts(transaction.id),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
