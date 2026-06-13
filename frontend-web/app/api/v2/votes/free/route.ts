import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { bridgedCastFreeVote } from '@/src/server/voting-bridge/bridge';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import type { CastFreeVoteRequest } from '@/src/features/voting/types';

function getIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}

function getDevice(request: Request): string {
  return request.headers.get('x-device-fingerprint') || '';
}

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
  const ip = getIp(request);

  const rateLimitResult = await checkRateLimit(ip);
  if (!rateLimitResult.allowed) {
    return errorResponse('Too many requests. Please slow down.', 429);
  }

  const idempotencyKey = request.headers.get('X-Idempotency-Key') ?? undefined;
  const userAgent = request.headers.get('user-agent') ?? '';

  let body: Partial<CastFreeVoteRequest>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { contestId, contestantId, voterIdentifier, captchaToken, shareCode, voteQuantity } = body;

  if (!contestId || !contestantId) {
    return errorResponse('contestId and contestantId are required', 400);
  }

  try {
    const userId = await tryGetUserId(request);
    const device = getDevice(request);

    const result = await bridgedCastFreeVote(
      { contestId, contestantId, voterIdentifier, captchaToken, shareCode, voteQuantity },
      ip,
      device,
      userAgent,
      userId,
      idempotencyKey,
    );

    return successResponse({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
