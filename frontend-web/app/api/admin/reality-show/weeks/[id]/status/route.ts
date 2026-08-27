import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getWeek, updateWeek, openVoting, closeVoting } from '@/src/server/services/reality-show/persistence';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const week = await getWeek(params.id);
    if (!week) return errorResponse('Week not found', 404);

    const body = await request.json() as { status?: string; evictionCount?: number; title?: string; theme?: string };
    const { status } = body;

    if (status === 'open') return successResponse({ week: await openVoting(params.id) });
    if (status === 'closed') return successResponse({ week: await closeVoting(params.id) });
    if (status === 'upcoming') return successResponse({ week: await updateWeek(params.id, { status: 'upcoming' }) });

    // Generic patch (title, theme, evictionCount)
    const patch: Record<string, unknown> = {};
    if (body.evictionCount !== undefined) patch.evictionCount = body.evictionCount;
    if (body.title !== undefined) patch.title = body.title;
    if (body.theme !== undefined) patch.theme = body.theme;
    return successResponse({ week: await updateWeek(params.id, patch as Parameters<typeof updateWeek>[1]) });
  } catch (error) {
    return handleApiError(error, 'Failed to update week status');
  }
}
