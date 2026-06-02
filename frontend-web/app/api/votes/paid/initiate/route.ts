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

export async function POST(request: Request) {
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
