import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getRemainingFreeVotes } from '@/src/server/voting/free-vote.service';

function getIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  );
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');
    if (!contestId) return errorResponse('contestId is required', 400);
    // Non-UUID ids can never match the uuid columns the service filters on —
    // reject here so a malformed id doesn't surface as a Postgres 22P02 → 500.
    if (!UUID_RE.test(contestId)) return errorResponse('Invalid contestId', 400);
    // Optional: scope the cap to a single contestant (per-contestant free votes).
    const contestantId = searchParams.get('contestantId') || undefined;
    if (contestantId && !UUID_RE.test(contestantId)) {
      return errorResponse('Invalid contestantId', 400);
    }

    const userId = await tryGetUserId(request);
    const ip = getIp(request);

    const result = await getRemainingFreeVotes(
      contestId,
      {
        userId,
        ipAddress: ip,
        deviceFingerprint: request.headers.get('x-device-fingerprint') || undefined,
      },
      contestantId,
    );

    return successResponse({ ...result });
  } catch (error) {
    return handleApiError(error, 'Failed to get remaining votes');
  }
}
