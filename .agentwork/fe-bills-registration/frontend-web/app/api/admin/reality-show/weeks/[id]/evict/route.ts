import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getWeek, finalizeEviction } from '@/src/server/services/reality-show/store';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    const week = getWeek(params.id);
    if (!week) return errorResponse('Week not found', 404);

    const body = await request.json().catch(() => ({})) as { note?: string };
    const result = finalizeEviction(params.id, identity.actorId, body.note);

    return successResponse({
      week: result.week,
      evictions: result.evictions,
      evictedContestants: result.evictedContestants,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to finalize eviction');
  }
}
