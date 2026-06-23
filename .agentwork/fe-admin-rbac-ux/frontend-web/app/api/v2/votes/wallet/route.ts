import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { isBridgeEnabled } from '@/src/server/voting-bridge/feature-flag';
import { checkAndClaimIdempotencyKey, storeIdempotencyResult } from '@/src/server/voting-bridge/idempotency';
import { assertKycGate } from '@/src/server/voting-bridge/kyc-gate';
import { enqueueOutboxEvent } from '@/src/server/voting-bridge/outbox';
import { castFreeVote } from '@/src/server/voting/free-vote.service';

// Calls the Go vote-bridge debit endpoint then credits votes via the legacy service.
// This route is the wallet-paid equivalent of the Paystack paid-vote flow.
async function goVoteDebit(
  token: string,
  contestId: string,
  contestantId: string,
  voteCount: number,
  costKobo: number,
  idempotencyKey: string,
): Promise<void> {
  const goApiBase = process.env.GO_API_BASE_URL ?? 'http://localhost:8080';
  const res = await fetch(`${goApiBase}/api/finance/vote-bridge/debit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ contest_id: contestId, contestant_id: contestantId, vote_count: voteCount, cost_kobo: costKobo, idempotency_key: idempotencyKey }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `wallet debit failed: ${res.status}`);
  }
}

export async function POST(request: Request) {
  if (process.env.FEATURE_VOTE_BRIDGE_ENABLED !== 'true' || !isBridgeEnabled()) {
    return errorResponse('Wallet voting is not enabled', 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { contestId, contestantId, voteCount, costKobo, idempotencyKey } = body;
  if (!contestId || !contestantId || !voteCount || !costKobo || !idempotencyKey) {
    return errorResponse('contestId, contestantId, voteCount, costKobo, and idempotencyKey are required', 400);
  }

  try {
    const user = await requireRequestUser(request);
    await assertKycGate(user.id);

    const cacheKey = `wallet-vote:${idempotencyKey as string}`;
    const cached = await checkAndClaimIdempotencyKey(cacheKey);
    if (cached) return successResponse(cached as Record<string, unknown>);

    // Extract bearer token to forward to Go backend.
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    await goVoteDebit(
      token,
      contestId as string,
      contestantId as string,
      Number(voteCount),
      Number(costKobo),
      idempotencyKey as string,
    );

    // Credit votes via the legacy service (free-vote path with count override).
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
    const ua = request.headers.get('user-agent') ?? '';
    const result = await castFreeVote(
      { contestId: contestId as string, contestantId: contestantId as string, voteQuantity: Number(voteCount) },
      ip,
      '',
      ua,
      user.id,
    );

    await storeIdempotencyResult(cacheKey, result);
    await enqueueOutboxEvent('votes.wallet.cast', {
      contestId,
      contestantId,
      voterId: user.id,
      votesAdded: result.votesAdded,
      costKobo,
    });

    return successResponse({ ...(result as unknown as Record<string, unknown>), costKobo });
  } catch (err) {
    return handleApiError(err);
  }
}
