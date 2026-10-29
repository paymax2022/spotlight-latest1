// Learner: read my own topic attempt — resumable questions + saved answers, or
// the committed result. Never the answer key.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { readTopicAttempt, TopicQuizError } from '@/src/server/services/academy/topics';

export async function GET(request: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics() || !featureFlags.filmAcademyAssessment()) {
      return errorResponse('Topic assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { attemptId } = await ctx.params;

    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) return errorResponse('You are not enrolled', 403);

    const attempt = await readTopicAttempt(
      supabase,
      { userId: user.id, enrollmentId: learner.enrollmentId },
      attemptId,
    );
    return successResponse({ success: true, attempt });
  } catch (error) {
    if (error instanceof TopicQuizError) return errorResponse(error.message, error.status);
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load the attempt');
  }
}
