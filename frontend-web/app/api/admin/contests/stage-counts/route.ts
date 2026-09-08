import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getStageCounts } from '@/src/server/registration-v2/stage-store';

/**
 * GET /api/admin/contests/stage-counts?ids=id1,id2,...
 *
 * Bulk stage counts for a contest list — one query for the whole page rather
 * than an N+1 of per-contest stage fetches. Contest ids are opaque here (the
 * caller already has them from listing contests/connect_contests); this just
 * tallies public.contest_stages rows against them.
 */
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');

    const url = new URL(request.url);
    const ids = (url.searchParams.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) return errorResponse('ids query param is required.', 400);

    const counts = await getStageCounts(ids);
    return successResponse({ success: true, counts });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest stage counts');
  }
}
