// Learner: near-real-time progression cursor. Polling this endpoint after a
// submit (or while a screen is foregrounded) reconciles grades across devices.
// The event stream is a notification aid; the mastery ledger remains the truth.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy';
import { listMasteryEvents } from '@/src/server/services/academy/topics';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const user = await requireRequestUser(request);
    const url = new URL(request.url);
    const sinceRaw = Number(url.searchParams.get('since') ?? '0');
    const limitRaw = Number(url.searchParams.get('limit') ?? '50');
    const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? Math.floor(sinceRaw) : 0;
    const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 100) : 50;

    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) return errorResponse('You are not enrolled', 403);

    const page = await listMasteryEvents(supabase, user.id, since, limit);
    return successResponse({ success: true, ...page });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load progression events');
  }
}
