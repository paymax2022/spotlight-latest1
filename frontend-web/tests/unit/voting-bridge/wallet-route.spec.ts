/**
 * POST /api/v2/votes/wallet — contract tests for the AUD-BILL-003 fix.
 *
 * The route previously forwarded the client-declared `costKobo` into the Go
 * wallet debit and credited via castFreeVote (which clamps to the FREE daily
 * allowance AFTER the money moved). Now `priceWalletVote()` produces the
 * quote, a mismatched client `costKobo` is a 400, the debited amount is always
 * the quote, credits go through the paid-path `creditWalletVotes`, and a
 * credit failure triggers the ledger reversal. Also pins the per-user rate
 * limit (AUD-SEC-001, shared bucket name with the v1 wallet route).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRequest } from '../golden-path/_fixtures';

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/server/voting-bridge/feature-flag', () => ({ isBridgeEnabled: vi.fn(() => true) }));
vi.mock('@/src/server/voting-bridge/idempotency', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/server/voting-bridge/idempotency')>();
  return {
    ...real, // keep the real boundClaimKey — the route's key binding is under test
    checkAndClaimIdempotencyKey: vi.fn(async () => null),
    storeIdempotencyResult: vi.fn(async () => undefined),
    releaseIdempotencyKey: vi.fn(async () => undefined),
  };
});
vi.mock('@/src/server/voting-bridge/kyc-gate', () => ({ assertKycTier: vi.fn(async () => undefined) }));
vi.mock('@/src/server/voting-bridge/outbox', () => ({ enqueueOutboxEvent: vi.fn(async () => undefined) }));
vi.mock('@/src/server/voting-bridge/wallet-pricing', () => ({ priceWalletVote: vi.fn() }));
vi.mock('@/src/server/voting-bridge/wallet-credit', () => ({
  creditWalletVotes: vi.fn(),
  markVotePurchaseReversed: vi.fn(async () => undefined),
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));
// NOTE: '@/src/lib/voting/rate-limit' is deliberately NOT mocked — the 429
// case needs the real bucket bookkeeping.

import { POST } from '../../../app/api/v2/votes/wallet/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { priceWalletVote } from '@/src/server/voting-bridge/wallet-pricing';
import { creditWalletVotes, markVotePurchaseReversed } from '@/src/server/voting-bridge/wallet-credit';
import { boundClaimKey, checkAndClaimIdempotencyKey, releaseIdempotencyKey } from '@/src/server/voting-bridge/idempotency';
import { enqueueOutboxEvent } from '@/src/server/voting-bridge/outbox';

const QUOTE = { voteCount: 50, costKobo: 500_000 };
const CREDIT = {
  alreadyProcessed: false,
  transactionId: 'tx-1',
  paymentReference: 'WVOTE-x',
  votesCredited: 50,
};

/** fetch stub: 200 on /debit and /reverse (or override per call). */
function stubGo(responses: Record<string, number> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    const status = u.endsWith('/reverse')
      ? (responses.reverse ?? 200)
      : (responses.debit ?? 200);
    return new Response(status === 200 ? '{"ok":true}' : '{"error":"fail"}', { status });
  }));
}

function voteRequest(body: Record<string, unknown>) {
  return makeRequest('/api/v2/votes/wallet', {
    body,
    headers: { authorization: 'Bearer tok' },
    ip: '203.0.113.70',
  });
}

const BODY = {
  contestId: 'contest-1',
  contestantId: 'contestant-1',
  voteCount: 50,
  idempotencyKey: 'idem-1',
};

/** The key all stores should see for BODY + a given user under QUOTE. */
const bound = (userId: string, clientKey = 'idem-1', fp = {
  contestId: 'contest-1', contestantId: 'contestant-1',
  voteCount: 50, costKobo: 500_000,
}) => boundClaimKey('wallet-vote', userId, clientKey, fp);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FEATURE_VOTE_BRIDGE_ENABLED', 'true');
  stubGo();
  vi.mocked(priceWalletVote).mockResolvedValue(QUOTE as never);
  vi.mocked(creditWalletVotes).mockResolvedValue(CREDIT as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/v2/votes/wallet', () => {
  it('debits the server quote, not the client-declared costKobo', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-wallet-2', email: 'u@x.com' } as never);
    const res = await POST(voteRequest({ ...BODY, costKobo: 500_000 }) as never);
    expect(res.status).toBe(200);
    const sent = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(sent.cost_kobo).toBe(500_000);
    expect(sent.vote_count).toBe(50);
  });

  it('the exploit: costKobo:1 for 50 votes is a 400 and no debit happens', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-wallet-3' } as never);
    const res = await POST(voteRequest({ ...BODY, costKobo: 1 }) as never);
    expect(res.status).toBe(400);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(vi.mocked(creditWalletVotes)).not.toHaveBeenCalled();
  });

  it('works without a client costKobo (quote-only contract)', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-wallet-4' } as never);
    const res = await POST(voteRequest(BODY) as never);
    expect(res.status).toBe(200);
    const sent = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(sent.cost_kobo).toBe(500_000);
  });

  it('still requires contestId/contestantId/voteCount/idempotencyKey', async () => {
    const res = await POST(voteRequest({ contestId: 'c' }) as never);
    expect(res.status).toBe(400);
    expect(vi.mocked(requireRequestUser)).not.toHaveBeenCalled();
  });

  it('reverses the debit and releases the claim when crediting fails', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-wallet-6' } as never);
    vi.mocked(creditWalletVotes).mockRejectedValue(new Error('votes insert failed'));
    const res = await POST(voteRequest(BODY) as never);
    expect(res.status).toBe(500);
    // debit then reverse
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/debit'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/reverse'))).toBe(true);
    expect(vi.mocked(markVotePurchaseReversed)).toHaveBeenCalledWith(bound('u-wallet-6'));
    expect(vi.mocked(releaseIdempotencyKey)).toHaveBeenCalledWith(bound('u-wallet-6'));
  });

  it('flags reconciliation via outbox when the reversal itself fails', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-wallet-7' } as never);
    stubGo({ reverse: 500 });
    vi.mocked(creditWalletVotes).mockRejectedValue(new Error('votes insert failed'));
    const res = await POST(voteRequest(BODY) as never);
    expect(res.status).toBe(500);
    expect(vi.mocked(markVotePurchaseReversed)).not.toHaveBeenCalled();
    expect(vi.mocked(enqueueOutboxEvent)).toHaveBeenCalledWith(
      'votes.wallet.reversal_failed',
      expect.objectContaining({
        idempotencyKey: bound('u-wallet-7'),
        clientIdempotencyKey: 'idem-1',
      }),
    );
  });

  it('releases the claim when the debit itself fails (no compensation needed)', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-wallet-8' } as never);
    stubGo({ debit: 402 });
    const res = await POST(voteRequest(BODY) as never);
    // The Go status propagates — insufficient balance stays a 402.
    expect(res.status).toBe(402);
    expect(vi.mocked(creditWalletVotes)).not.toHaveBeenCalled();
    expect(vi.mocked(releaseIdempotencyKey)).toHaveBeenCalledWith(bound('u-wallet-8'));
  });

  it('surfaces Go\'s spent-key 409 when the debit was already reversed', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-wallet-9' } as never);
    stubGo({ debit: 409 });
    const res = await POST(voteRequest(BODY) as never);
    expect(res.status).toBe(409);
    // Never credit against refunded money — and the claim is released so the
    // client learns fast rather than wedging the key.
    expect(vi.mocked(creditWalletVotes)).not.toHaveBeenCalled();
    expect(vi.mocked(releaseIdempotencyKey)).toHaveBeenCalledWith(bound('u-wallet-9'));
  });

  it('binds the claim, Go debit, and tx idempotency to user + payload', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-bound-1' } as never);
    const res = await POST(voteRequest(BODY) as never);
    expect(res.status).toBe(200);
    const key = bound('u-bound-1');
    expect(key.startsWith('wallet-vote:u-bound-1:idem-1:')).toBe(true);
    expect(vi.mocked(checkAndClaimIdempotencyKey)).toHaveBeenCalledWith(key);
    const sent = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(sent.idempotency_key).toBe(key);
    expect(vi.mocked(creditWalletVotes)).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: key }),
    );
  });

  it('a client key reused by another user produces a different bound key', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-bound-a' } as never);
    await POST(voteRequest(BODY) as never);
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-bound-b' } as never);
    await POST(voteRequest(BODY) as never);
    const keys = vi.mocked(checkAndClaimIdempotencyKey).mock.calls.map((c) => c[0]);
    expect(keys[0]).toBe(bound('u-bound-a'));
    expect(keys[1]).toBe(bound('u-bound-b'));
    expect(keys[0]).not.toBe(keys[1]);
    // Both executed — user B's purchase is NOT absorbed by user A's claim.
    expect(vi.mocked(creditWalletVotes)).toHaveBeenCalledTimes(2);
  });

  it('the same user + key with a changed payload is a distinct operation', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-bound-c' } as never);
    await POST(voteRequest(BODY) as never);
    await POST(voteRequest({ ...BODY, contestantId: 'contestant-2' }) as never);
    const keys = vi.mocked(checkAndClaimIdempotencyKey).mock.calls.map((c) => c[0]);
    expect(keys[1]).toBe(bound('u-bound-c', 'idem-1', {
      contestId: 'contest-1', contestantId: 'contestant-2',
      voteCount: 50, costKobo: 500_000,
    }));
    expect(keys[0]).not.toBe(keys[1]);
    expect(vi.mocked(creditWalletVotes)).toHaveBeenCalledTimes(2);
  });

  it('a true replay returns the cached result without debiting again', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-bound-d' } as never);
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValueOnce(null as never);
    await POST(voteRequest(BODY) as never);
    vi.mocked(checkAndClaimIdempotencyKey).mockResolvedValueOnce({ votesAdded: 50 } as never);
    const res = await POST(voteRequest(BODY) as never);
    const body = await res.json();
    expect(body.votesAdded).toBe(50);
    // One debit total — the replay was served from the claim.
    const debits = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).endsWith('/debit'));
    expect(debits).toHaveLength(1);
  });

  it('429s the 11th purchase in a minute for one user (shared v1/v2 bucket)', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-wallet-5' } as never);
    for (let i = 0; i < 10; i++) {
      const res = await POST(voteRequest(BODY) as never);
      expect(res.status).toBe(200);
    }
    const blocked = await POST(voteRequest(BODY) as never);
    expect(blocked.status).toBe(429);
  });
});
