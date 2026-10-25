// Learner: one topic. The article, media URLs and instructions are withheld
// unless the topic is published; publication blockers and holds are returned so
// a locked screen can explain the reason instead of reading as a broken app.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { loadTopicForLearner } from '@/src/server/services/academy/topics';

export async function GET(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { topicId } = await ctx.params;
    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) {
      return errorResponse(
        learner.reason === 'tuition_unpaid'
          ? 'Your tuition must be settled before the course opens.'
          : 'You are not yet enrolled in the Film Academy.',
        403,
      );
    }

    const topic = await loadTopicForLearner(
      supabase,
      { userId: user.id, enrollmentId: learner.enrollmentId },
      topicId,
    );
    if (!topic) return errorResponse('Topic not found', 404);
    return successResponse({ success: true, topic });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load the topic');
  }
}
