import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { getUserUtilityTransaction, requeryUtilityTransaction } from '@/src/server/utility/service';
import { requireUtilityUser, utilityUnavailableResponse } from '../../../_utils';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const transaction = await getUserUtilityTransaction(user.id, params.id);
    return successResponse({ success: true, transaction: await requeryUtilityTransaction(transaction) });
  } catch (err) {
    return handleApiError(err);
  }
}
