import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getPersistedContestBySlug } from '@/src/server/registration-v2/contest-store';
import { advanceStageSurvivors } from '@/src/server/registration-v2/stage-store';

/**
 * POST /api/admin/contests/:slug/stage-advance { stageNumber } — moves a
 * stage's survivors into the next stage. A separate route rather than
 * nesting under stages/[stageId] because that segment is already claimed by
 * the stage UUID (stages/[stageId]/route.ts); this operates on a stage
 * NUMBER, not a stage id, and Next.js requires one dynamic segment name per
 * path position.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const contest = await getPersistedContestBySlug(params.slug);
    if (!contest?.id) return errorResponse('Contest not found', 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const stageNumber = Number(body.stageNumber);
    if (!Number.isFinite(stageNumber) || stageNumber < 1) {
      return errorResponse('stageNumber must be a positive integer.', 400);
    }

    const result = await advanceStageSurvivors(contest.id, stageNumber);
    return successResponse({ success: true, result });
  } catch (error) {
    return handleApiError(error, 'Failed to advance stage survivors');
  }
}
