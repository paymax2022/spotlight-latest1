// Learner: submit + finalize. At-most-once; a duplicate submit returns the same
// committed receipt, and the exact 85% gate is decided server-side.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { submitTopicAttempt, TopicQuizError } from '@/src/server/services/academy/topics';

export async function POST(request: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics() || !featureFlags.filmAcademyAssessment()) {
      return errorResponse('Topic assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { attemptId } = await ctx.params;

    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) return errorResponse('You are not enrolled', 403);

    const result = await submitTopicAttempt(
      supabase,
      { userId: user.id, enrollmentId: learner.enrollmentId },
      attemptId,
    );
    return successResponse({ success: true, result });
  } catch (error) {
    if (error instanceof TopicQuizError) return errorResponse(error.message, error.status);
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to submit the topic quiz');
  }
}
