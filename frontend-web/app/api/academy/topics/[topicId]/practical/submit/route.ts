// Learner: submit the current draft for review. The rubric and pass mark are
// frozen onto the submission here; a replay returns the already-submitted row.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { submitPracticalSubmission } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function POST(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics() || !featureFlags.filmAcademyAssessment()) {
      return errorResponse('Practical assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { topicId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { submissionId?: unknown } | null;
    const submissionId = String(body?.submissionId ?? '').trim();
    if (!submissionId) return errorResponse('submissionId is required', 400);

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

    const submission = await submitPracticalSubmission(
      supabase,
      { userId: user.id, enrollmentId: learner.enrollmentId },
      topicId,
      submissionId,
    );
    return successResponse({ success: true, submission });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return topicErrorResponse(error, 'Failed to submit the practical');
  }
}
