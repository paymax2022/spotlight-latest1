import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { listProducts } from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityUser, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);
    const url = new URL(request.url);
    const category = parseUtilityCategory(url.searchParams.get('category'));
    const billerId = url.searchParams.get('biller') || url.searchParams.get('biller_id') || undefined;
    return successResponse({ success: true, products: await listProducts({ category, billerId }) });
  } catch (err) {
    return handleApiError(err);
  }
}
