/**
 * POST /api/v2/votes/paid/initiate - Initiate a paid vote
 * Does not use the bridge — direct call to protected initiatePaidVote()
 * (mirrors the sibling /api/v2/votes/paid/verify route's "direct call, no
 * bridge needed" design, per the vote-bridge skill's documented layout).
 *
 * CONTEST-002 fix: the previous version of this file did its own raw
 * `INSERT INTO vote_transactions` using columns that don't exist on the real
 * table (voter_id, competition_id, amount_kobo — the real columns are
 * voter_user_id, contest_id, amount_expected/votes_purchased/bonus_votes/
 * total_votes_to_credit), skipped initiatePaidVote()'s validation
 * (voting-open check, package pricing), and returned a paymentUrl pointing
 * at a route that doesn't exist. It was never cut over to by any client —
 * the live client call sites still use the older, safe
 * /api/votes/paid/initiate route below — and calling this one as written
 * would have failed outright. This rewrite makes it a real, working
 * equivalent of that route at the /v2 path, matching InitiatePaidVoteRequest
 * exactly (voterEmail/voterName required — not an authenticated-user-only
 * flow), so it's actually safe to cut a client over to in the future.
 */

import { NextRequest } from 'next/server';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { initiatePaidVote } from '@/src/server/voting/paid-vote.service';
import type { InitiatePaidVoteRequest } from '@/src/features/voting/types';

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as InitiatePaidVoteRequest;

    if (!body.contestId) return errorResponse('contestId is required', 400);
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
