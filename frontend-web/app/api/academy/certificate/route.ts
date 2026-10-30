// Learner: the programme credential and exactly what still blocks it.
//
// GET is a read; POST asks the server to issue. POST does not accept any claim
// of eligibility — the service recomputes the full mastery ledger and refuses
// unless every topic is published, mastered and hold-free.

import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { issueCertificate, readLearnerCertificate } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const user = await requireRequestUser(request);
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
    const result = await readLearnerCertificate(supabase, learner.enrollmentId);
    return successResponse({ success: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return topicErrorResponse(error, 'Failed to load your certificate');
  }
}

export async function POST(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Credential issuance is not available yet', 503);
    }
    const user = await requireRequestUser(request);
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
    const result = await issueCertificate(supabase, {
      enrollmentId: learner.enrollmentId,
      userId: user.id,
      actorId: user.id,
      actorRole: 'learner',
    });
    return successResponse({ success: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return topicErrorResponse(error, 'Failed to issue your certificate');
  }
}
