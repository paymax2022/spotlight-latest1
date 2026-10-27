// Learner: autosave one answer. The server owns the deadline and the option
// validity; a save after expiry is refused but the prior answers stand.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { ExamError, saveResponse } from '@/src/server/services/academy/assessment';

export async function POST(request: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { attemptId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as
      { attemptQuestionId?: string; presentationOptionId?: string } | null;
    const attemptQuestionId = String(body?.attemptQuestionId ?? '').trim();
    const presentationOptionId = String(body?.presentationOptionId ?? '').trim();
    if (!attemptQuestionId || !presentationOptionId) {
      return errorResponse('attemptQuestionId and presentationOptionId are required', 400);
    }

    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) return errorResponse('You are not enrolled', 403);

    const saved = await saveResponse(supabase, attemptId, {
      enrollmentId: learner.enrollmentId, programId: learner.programId, batchId: learner.batchId,
    }, attemptQuestionId, presentationOptionId);
    return successResponse({ success: true, ...saved });
  } catch (error) {
    if (error instanceof ExamError) return errorResponse(error.message, error.status, error.code);
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to save your answer');
  }
}
