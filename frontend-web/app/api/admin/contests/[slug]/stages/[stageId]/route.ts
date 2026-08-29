import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getPersistedContestBySlug } from '@/src/server/registration-v2/contest-store';
import { deleteContestStage, updateContestStage } from '@/src/server/registration-v2/stage-store';

export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string; stageId: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const contest = await getPersistedContestBySlug(params.slug);
    if (!contest?.id) return errorResponse('Contest not found', 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let evictionPercentage: number | undefined;
    if (body.evictionPercentage !== undefined) {
      evictionPercentage = Number(body.evictionPercentage);
      if (!Number.isFinite(evictionPercentage) || evictionPercentage <= 0 || evictionPercentage >= 100) {
        return errorResponse('Eviction percentage must be between 1 and 99.', 400);
      }
    }

    const stage = await updateContestStage(contest.id, params.stageId, {
      stageNumber: body.stageNumber !== undefined ? Number(body.stageNumber) : undefined,
      stageName: body.stageName !== undefined ? String(body.stageName).trim() : undefined,
      stageDescription: body.stageDescription !== undefined ? String(body.stageDescription) : undefined,
      promotionCriteria: body.promotionCriteria !== undefined ? String(body.promotionCriteria) : undefined,
      votingStartsAt: body.votingStartsAt !== undefined ? (body.votingStartsAt ? String(body.votingStartsAt) : null) : undefined,
      votingEndsAt: body.votingEndsAt !== undefined ? (body.votingEndsAt ? String(body.votingEndsAt) : null) : undefined,
      evictionPercentage,
    });
    return successResponse({ success: true, stage });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('not found')) return errorResponse(message, 404);
    return handleApiError(error, 'Failed to update contest stage');
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string; stageId: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const contest = await getPersistedContestBySlug(params.slug);
    if (!contest?.id) return errorResponse('Contest not found', 404);

    await deleteContestStage(contest.id, params.stageId);
    return successResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('not found')) return errorResponse(message, 404);
    return handleApiError(error, 'Failed to delete contest stage');
  }
}
