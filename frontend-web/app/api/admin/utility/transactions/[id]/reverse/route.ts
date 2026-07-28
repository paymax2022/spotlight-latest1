import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { adminGetUtilityTransaction, reverseUtilityTransaction } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../../_utils';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const body = await request.json() as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return errorResponse('reason is required.', 400);
    const transaction = await adminGetUtilityTransaction(params.id);
    const reversed = await reverseUtilityTransaction(transaction, reason);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.transaction.reverse',
      entityType: 'utility_transaction',
      entityId: params.id,
      oldValue: { status: transaction.status },
      newValue: { status: reversed.status },
      reason,
    });
    return successResponse({ success: true, transaction: reversed });
  } catch (err) {
    return handleApiError(err);
  }
}
