import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminGetUtilityTransaction, requeryUtilityTransaction } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilitySupport, utilityAdminUnavailableResponse } from '../../../_utils';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilitySupport(request);
    const transaction = await adminGetUtilityTransaction(params.id);
    const updated = await requeryUtilityTransaction(transaction);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.transaction.requery',
      entityType: 'utility_transaction',
      entityId: params.id,
      oldValue: { status: transaction.status },
      newValue: { status: updated.status },
    });
    return successResponse({ success: true, transaction: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
