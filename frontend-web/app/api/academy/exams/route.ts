// Learner: the exams offered to my programme, with attempts remaining.
// No question content and no answer key ever leave this endpoint — the learner
// only sees exam metadata and whether they can start it.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { listLearnerExams } from '@/src/server/services/academy/assessment';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) {
      return successResponse({ success: true, locked: true, reason: learner.reason, exams: [] });
    }

    const exams = await listLearnerExams(supabase, {
      enrollmentId: learner.enrollmentId,
      programId: learner.programId,
      batchId: learner.batchId,
    });

    return successResponse({ success: true, locked: false, enrollmentId: learner.enrollmentId, exams });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load exams');
  }
}
