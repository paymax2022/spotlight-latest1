import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { listBillers } from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityUser, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);
    const url = new URL(request.url);
    const category = parseUtilityCategory(url.searchParams.get('category'));
    return successResponse({ success: true, billers: await listBillers(category) });
  } catch (err) {
    return handleApiError(err);
  }
}
