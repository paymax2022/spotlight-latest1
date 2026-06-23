import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { listUtilityCategories } from '@/src/server/utility/service';
import { requireUtilityUser, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);
    return successResponse({ success: true, categories: await listUtilityCategories() });
  } catch (err) {
    return handleApiError(err);
  }
}
