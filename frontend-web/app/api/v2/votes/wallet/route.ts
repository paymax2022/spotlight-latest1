import { ApiError, errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { isBridgeEnabled } from '@/src/server/voting-bridge/feature-flag';
import { boundClaimKey, checkAndClaimIdempotencyKey, releaseIdempotencyKey, storeIdempotencyResult } from '@/src/server/voting-bridge/idempotency';
import { assertKycTier } from '@/src/server/voting-bridge/kyc-gate';
import { enqueueOutboxEvent } from '@/src/server/voting-bridge/outbox';
import { priceWalletVote } from '@/src/server/voting-bridge/wallet-pricing';
import { creditWalletVotes, markVotePurchaseReversed } from '@/src/server/voting-bridge/wallet-credit';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { getRequestIp } from '@/src/lib/rate-limit/client-ip';
import { GO_BACKEND_URL } from '@/src/lib/go-backend';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const goApiBase = process.env.GO_API_BASE_URL ?? GO_BACKEND_URL;
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
    // Keep the Go status — a 409 is the spent-key signal (debit reversed), and
    // flattening it to 500 would tell the client to retry a refunded purchase.
    throw new ApiError(
      (body as { error?: string }).error ?? `wallet debit failed: ${res.status}`,
      res.status,
    );
  }
}

// Saga compensation for a committed debit whose vote credit failed: the Go
// endpoint reverses by the RECORDED debit amount (the request carries none).
async function goVoteReverse(
  token: string,
  contestId: string,
  contestantId: string,
  idempotencyKey: string,
): Promise<void> {
  const goApiBase = process.env.GO_API_BASE_URL ?? GO_BACKEND_URL;
  const res = await fetch(`${goApiBase}/api/finance/vote-bridge/reverse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ contest_id: contestId, contestant_id: contestantId, idempotency_key: idempotencyKey }),
  });
  // 404 means no committed debit exists for the key — nothing to refund.
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `wallet reversal failed: ${res.status}`);
  }
}

export async function POST(request: Request) {
  if (process.env.FEATURE_VOTE_BRIDGE_ENABLED !== 'true' || !isBridgeEnabled()) {
    return errorResponse('Wallet voting is not enabled', 403);
  }

  try {
    const user = await requireRequestUser(request);

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse('Invalid JSON body', 400);
    }

    const { contestId, contestantId, voteCount, costKobo, idempotencyKey } = body;
    if (!contestId || !contestantId || !voteCount || !idempotencyKey) {
      return errorResponse('contestId, contestantId, voteCount, and idempotencyKey are required', 400);
    }
    // Non-UUID ids can never satisfy the contestants/contests equality checks
    // downstream — reject before the KYC gate and pricing queries hit Postgres.
    if (typeof contestId !== 'string' || !UUID_RE.test(contestId)) {
      return errorResponse('Invalid contestId', 400);
    }
    if (typeof contestantId !== 'string' || !UUID_RE.test(contestantId)) {
      return errorResponse('Invalid contestantId', 400);
    }

    // Wallet-debit money path — per-user throttle (AUD-SEC-001). The same
    // bucket name is used by the v1 wallet route so both share one allowance.
    const rl = checkRateLimit(`vote:paid:wallet:${user.id}`, 10, 60_000);
    if (!rl.allowed) {
      return errorResponse('Too many requests. Please slow down.', 429);
    }

    await assertKycTier(user.id, contestantId as string);

    // AUD-BILL-003: the price is quoted server-side (voting_settings gates +
    // vote_packages base rate). The caller's costKobo is never trusted — when
    // present it must match the quote, which catches stale/mispriced clients
    // instead of silently charging a different amount than displayed.
    const quote = await priceWalletVote(contestId as string, contestantId as string, Number(voteCount));
    if (costKobo !== undefined && Number(costKobo) !== quote.costKobo) {
      return errorResponse(`costKobo does not match the server-quoted price (${quote.costKobo})`, 400);
    }

    // The raw client key is unscoped — user A's key reused by user B (or the
    // same user with a different contest/contestant/amount) must not share a
    // claim, cached result, ledger idempotency row, or transaction record.
    // The bound key is the ONE key all four stores see, so a replay dedupes
    // only the exact operation it describes.
    const boundKey = boundClaimKey('wallet-vote', user.id, idempotencyKey as string, {
      contestId: contestId as string,
      contestantId: contestantId as string,
      voteCount: quote.voteCount,
      costKobo: quote.costKobo,
    });
    const cached = await checkAndClaimIdempotencyKey(boundKey);
    if (cached) return successResponse(cached as Record<string, unknown>);

    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const ip = getRequestIp(request);
    const ua = request.headers.get('user-agent') ?? '';

    try {
      await goVoteDebit(
        token,
        contestId as string,
        contestantId as string,
        quote.voteCount,
        quote.costKobo,
        boundKey,
      );
    } catch (debitErr) {
      // No money moved (or an idempotent no-op failed) — release the claim so
      // the same key can be retried after the user tops up / fixes the cause.
      await releaseIdempotencyKey(boundKey);
      throw debitErr;
    }

    // Credit via the paid path (vote_transactions + votes + totals), NOT
    // castFreeVote — the free-vote service clamps to the daily FREE allowance
    // and can 429 after the money has moved.
    let result;
    try {
      result = await creditWalletVotes({
        contestId: contestId as string,
        contestantId: contestantId as string,
        userId: user.id,
        voterEmail: user.email,
        voteCount: quote.voteCount,
        costKobo: quote.costKobo,
        idempotencyKey: boundKey,
        ip,
        userAgent: ua,
      });
    } catch (creditErr) {
      // The debit is committed — compensate. Reversal is idempotent and uses
      // the ledger-recorded amount; if it fails, the outbox event gives
      // reconciliation a handle (charge held, transaction row flagged).
      const reversed = await goVoteReverse(token, contestId as string, contestantId as string, boundKey)
        .then(() => true)
        .catch(() => false);
      if (reversed) {
        await markVotePurchaseReversed(boundKey).catch(() => {});
      } else {
        await enqueueOutboxEvent('votes.wallet.reversal_failed', {
          idempotencyKey: boundKey,
          clientIdempotencyKey: idempotencyKey,
          contestId,
          contestantId,
          voterId: user.id,
          costKobo: quote.costKobo,
        }).catch(() => {});
      }
      await releaseIdempotencyKey(boundKey);
      throw creditErr;
    }

    const response = {
      alreadyProcessed: result.alreadyProcessed,
      transactionId: result.transactionId,
      paymentReference: result.paymentReference,
      votesAdded: result.votesCredited,
      costKobo: quote.costKobo,
    };
    await storeIdempotencyResult(boundKey, response);
    await enqueueOutboxEvent('votes.wallet.cast', {
      contestId,
      contestantId,
      voterId: user.id,
      votesAdded: result.votesCredited,
      costKobo: quote.costKobo,
    });

    return successResponse(response);
  } catch (err) {
    return handleApiError(err);
  }
}
