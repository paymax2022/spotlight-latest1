import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getContestBySlug } from '@/src/server/stem/persistence';

export async function GET(
  _request: Request,
  context: { params: { slug: string } }
) {
  try {
    const contest = await getContestBySlug(context.params.slug);
    if (!contest) return errorResponse('Contest not found', 404);
    return successResponse({ success: true, contest });
  } catch (error) {
    return handleApiError(error, 'Failed to load STEM contest details');
  }
}
