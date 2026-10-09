import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getContestById } from '@/src/server/openmic/persistence';
import { createOpenMicVoteIntent } from '@/src/server/payments/openmic-vote-intents';
import { randomUUID } from 'node:crypto';

// contests.id / competition_entries.id are uuid columns — a malformed id fed
// into .eq() surfaces as a Postgres 22P02 inside getContestById/the intent
// insert and 500s, so shape-check before touching the store.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);

    const body = (await request.json().catch(() => null)) as {
      contestId?: string;
      submissionId?: string;
      stageName?: string;
      votes?: number;
      // Accepted for backward compatibility with older clients; never trusted —
      // the charged amount is derived from the contest's server-side
      // vote_price_ngn (AUD-FE-009: a client-declared price let a caller set
      // the Paystack charge arbitrarily low and still be granted the votes).
      votePriceNgn?: number;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);

    if (!body.contestId)    return errorResponse('contestId is required', 400);
    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    if (!UUID_RE.test(body.contestId))    return errorResponse('contestId must be a valid UUID', 400);
    if (!UUID_RE.test(body.submissionId)) return errorResponse('submissionId must be a valid UUID', 400);
    // Fractional/unsafe-integer votes would mint a non-integer amount_kobo and
    // fail the integer votes column downstream — refuse at the boundary.
    if (!body.votes || !Number.isInteger(body.votes) || body.votes <= 0 || body.votes > Number.MAX_SAFE_INTEGER) {
      return errorResponse('votes must be a positive integer', 400);
    }

    const contest = await getContestById(body.contestId);
    const votePriceNgn = contest?.votingConfig?.votePrice ?? 0;
    if (!contest || !(votePriceNgn > 0)) {
      return errorResponse('Paid voting is not available for this contest', 400);
    }

    const reference = `om-vote-${randomUUID()}`;
    const amountKobo = Math.round(body.votes * votePriceNgn * 100);

    // Persist the charge intent before the client pays: the webhook gateway
    // handler and /api/v1/payments/gateway/recover fulfil from this record if
    // the client never reaches verify (AUD-FE-003 residual).
    await createOpenMicVoteIntent({
      reference,
      contestId: body.contestId,
      submissionId: body.submissionId,
      voterUserId: user.id,
      votes: body.votes,
      amountKobo,
      stageName: body.stageName,
    });

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';

    return successResponse({
      reference,
      amountKobo,
      amountNgn: amountKobo / 100,
      email: user.email ?? '',
      publicKey,
      metadata: {
        contestId: body.contestId,
        submissionId: body.submissionId,
        stageName: body.stageName ?? '',
        votes: body.votes,
        votePriceNgn,
        userId: user.id,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to initiate payment');
  }
}
