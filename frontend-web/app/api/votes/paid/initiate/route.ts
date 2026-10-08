import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { initiatePaidVote } from '@/src/server/voting/paid-vote.service';
import type { InitiatePaidVoteRequest } from '@/src/features/voting/types';

// voting_settings.contest_id is a uuid column — a malformed id fed into .eq()
// surfaces as a Postgres 22P02 → 500 ("Failed to load voting settings"), so
// shape-check before the service's first store read. Gate lives at the route
// boundary: src/server/voting/* is protected legacy code.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tryGetUserId(request: Request): Promise<string | undefined> {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return undefined;
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser(token);
    return data.user?.id;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as InitiatePaidVoteRequest;
    if (!body) return errorResponse('Invalid JSON body', 400);

    if (!body.contestId) return errorResponse('contestId is required', 400);
    if (!UUID_RE.test(body.contestId)) return errorResponse('contestId must be a valid UUID', 400);
    if (!body.contestantId) return errorResponse('contestantId is required', 400);
    if (!body.voterEmail) return errorResponse('voterEmail is required', 400);
    if (!body.voterName) return errorResponse('voterName is required', 400);
    if (!body.packageId && !body.customVoteQuantity) {
      return errorResponse('Either packageId or customVoteQuantity is required', 400);
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '0.0.0.0';
    const ua = request.headers.get('user-agent') || '';
    const userId = await tryGetUserId(request);

    const result = await initiatePaidVote(body, ip, ua, userId);
    return successResponse({ ...result });
  } catch (error) {
    return handleApiError(error, 'Failed to initiate payment');
  }
}
