// Learner: submit + finalize. At-most-once — a duplicate submit returns the
// same committed receipt, and the score is computed and written server-side.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { ExamError, submitAttempt } from '@/src/server/services/academy/assessment';

export async function POST(request: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { attemptId } = await ctx.params;

    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) return errorResponse('You are not enrolled', 403);

    const receipt = await submitAttempt(supabase, attemptId, {
      enrollmentId: learner.enrollmentId, programId: learner.programId, batchId: learner.batchId,
    });
    return successResponse({ success: true, result: receipt });
  } catch (error) {
    if (error instanceof ExamError) return errorResponse(error.message, error.status);
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to submit your exam');
  }
}
