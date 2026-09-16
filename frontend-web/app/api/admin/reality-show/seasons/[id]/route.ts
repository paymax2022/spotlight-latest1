import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import {
  getSeason, updateSeason,
  listContestants, listWeeks,
  getEvictionsForSeason,
} from '@/src/server/services/reality-show/persistence';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'dashboard:view');
    const season = await getSeason(params.id);
    if (!season) return errorResponse('Season not found', 404);

    const contestants = await listContestants(params.id);
    const weeks = await listWeeks(params.id);
    const evictions = await getEvictionsForSeason(params.id);

    return successResponse({ season, contestants, weeks, evictions });
  } catch (error) {
    return handleApiError(error, 'Failed to get season');
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const season = await getSeason(params.id);
    if (!season) return errorResponse('Season not found', 404);

    const body = await request.json() as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const allowed = [
      'seasonName', 'seasonNumber', 'currentPhase', 'status',
      'auditionStartDate', 'auditionEndDate', 'bootcampStartDate', 'bootcampEndDate', 'notes',
    ];
    for (const key of allowed) {
      if (key in body) patch[key] = body[key];
    }
    const updated = await updateSeason(params.id, patch as Parameters<typeof updateSeason>[1]);
    return successResponse({ season: updated });
  } catch (error) {
    return handleApiError(error, 'Failed to update season');
  }
}
