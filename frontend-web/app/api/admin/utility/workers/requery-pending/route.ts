import { successResponse, handleApiError, errorResponse } from '@/src/lib/api/responses';
import { requeryPendingUtilityTransactions } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function POST(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const identity = await requireUtilityManager(request);
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '25', 10) || 25, 100);
    if (limit <= 0) return errorResponse('limit must be positive.', 400);

    const result = await requeryPendingUtilityTransactions(limit);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.worker.requery_pending',
      entityType: 'utility_transaction',
      newValue: result,
    });

    return successResponse({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
