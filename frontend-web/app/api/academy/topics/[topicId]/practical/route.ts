// Learner: the practical brief with this learner's own submission history, and
// the draft save. Eligibility and the pass rule are decided by the server; the
// client cannot pick an enrolment or a score.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { loadPracticalForLearner, savePracticalDraft } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics() || !featureFlags.filmAcademyAssessment()) {
      return errorResponse('Practical assessments are not available yet', 503);
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

    const practical = await loadPracticalForLearner(
      supabase,
      { userId: user.id, enrollmentId: learner.enrollmentId },
      topicId,
    );
    return successResponse({ success: true, practical });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return topicErrorResponse(error, 'Failed to load the practical assessment');
  }
}

export async function PUT(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics() || !featureFlags.filmAcademyAssessment()) {
      return errorResponse('Practical assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { topicId } = await ctx.params;
    const body = await request.json().catch(() => null);

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

    const submission = await savePracticalDraft(
      supabase,
      { userId: user.id, enrollmentId: learner.enrollmentId },
      topicId,
      body,
    );
    return successResponse({ success: true, submission });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return topicErrorResponse(error, 'Failed to save the practical draft');
  }
}
