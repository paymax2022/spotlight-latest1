// Learner: start — or resume — an authoritative topic attempt. The draw, the
// shuffled presentation and the deadline are all created here. The same
// idempotency key returns the same attempt, so a double tap cannot draw twice.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { startTopicAttempt, TopicQuizError } from '@/src/server/services/academy/topics';

function readKey(request: Request, body: { idempotencyKey?: unknown } | null): string {
  const fromBody = body && typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
  const fromHeader = request.headers.get('idempotency-key') ?? '';
  return (fromBody || fromHeader).trim() || crypto.randomUUID();
}

export async function POST(request: Request, ctx: { params: Promise<{ topicId: string }> }) {
  try {
    if (!featureFlags.filmAcademyTopics() || !featureFlags.filmAcademyAssessment()) {
      return errorResponse('Topic assessments are not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const { topicId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { idempotencyKey?: string } | null;

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

    const attempt = await startTopicAttempt(
      supabase,
      { userId: user.id, enrollmentId: learner.enrollmentId },
      topicId,
      readKey(request, body),
    );
    return successResponse({ success: true, attempt });
  } catch (error) {
    if (error instanceof TopicQuizError) return errorResponse(error.message, error.status);
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to start the topic quiz');
  }
}
