import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getPersistedContestBySlug } from '@/src/server/registration-v2/contest-store';
import { createContestStage, listContestStages } from '@/src/server/registration-v2/stage-store';

// Same permission as every other /api/admin/contests/* route — stages are
// part of a contest's definition, not a separately-scoped resource.

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const contest = await getPersistedContestBySlug(params.slug);
    if (!contest?.id) return errorResponse('Contest not found', 404);
    const stages = await listContestStages(contest.id);
    return successResponse({ success: true, stages });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest stages');
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const contest = await getPersistedContestBySlug(params.slug);
    if (!contest?.id) return errorResponse('Contest not found', 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const stageName = String(body.stageName || '').trim();
    if (!stageName) return errorResponse('Stage name is required.', 400);

    let stageNumber = Number(body.stageNumber);
    if (!Number.isFinite(stageNumber) || stageNumber < 1) {
      const existing = await listContestStages(contest.id);
      stageNumber = existing.reduce((max, s) => Math.max(max, s.stageNumber), 0) + 1;
    }

    const stage = await createContestStage(contest.id, {
      stageNumber,
      stageName,
      stageDescription: body.stageDescription ? String(body.stageDescription) : undefined,
      promotionCriteria: body.promotionCriteria ? String(body.promotionCriteria) : undefined,
      votingStartsAt: body.votingStartsAt ? String(body.votingStartsAt) : null,
      votingEndsAt: body.votingEndsAt ? String(body.votingEndsAt) : null,
    });
    return successResponse({ success: true, stage }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create contest stage');
  }
}
