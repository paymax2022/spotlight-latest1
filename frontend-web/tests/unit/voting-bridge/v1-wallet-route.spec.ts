/**
 * POST /api/votes/paid/wallet — residuals follow-through for the wallet-paid
 * money path.
 *
 * Pinned behaviour:
 *  - the ledger idempotency key and vote_transactions.idempotency_key are
 *    bound to user + purchase shape, so a reused raw key can never collide
 *    across users or silently dedupe a different purchase;
 *  - a votes-insert failure AFTER the committed debit reverses the charge and
 *    flips the transaction to 'reversed' (and flags reconciliation when the
 *    reversal itself fails) instead of stranding the money;
 *  - a replay of a credited transaction whose votes row never landed
 *    self-heals the fulfilment instead of reporting phantom success;
 *  - a replay of a 'reversed' transaction is a spent-key 409.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../golden-path/_fixtures';

vi.mock('@/src/lib/feature-flags', () => ({
  featureFlags: { wallet: vi.fn(() => true) },
}));
vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({
  debitWallet: vi.fn(async () => ({ alreadyProcessed: false })),
  reverseWalletDebit: vi.fn(async () => undefined),
}));
vi.mock('@/src/server/wallet/idempotency', () => ({
  checkIdempotencyKey: vi.fn(async () => ({ alreadyProcessed: false })),
}));
vi.mock('@/src/server/voting-bridge/outbox', () => ({ enqueueOutboxEvent: vi.fn(async () => undefined) }));
vi.mock('@/src/server/voting/free-vote.service', () => ({
  getVotingSettings: vi.fn(async () => ({ paidVotingEnabled: true })),
  assertVotingOpen: vi.fn(),
}));
vi.mock('@/src/server/voting/totals.service', () => ({ incrementVoteTotals: vi.fn(async () => undefined) }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
// rate-limit is deliberately NOT mocked — it is a real money-path control.

import { POST } from '../../../app/api/votes/paid/wallet/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { debitWallet, reverseWalletDebit } from '@/src/server/wallet/service';
import { checkIdempotencyKey } from '@/src/server/wallet/idempotency';
import { enqueueOutboxEvent } from '@/src/server/voting-bridge/outbox';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { boundClaimKey } from '@/src/server/voting-bridge/idempotency';
import { createAdminClient } from '@/lib/supabase/server';

const PKG = { id: 'pkg-1', votes: 10, bonus_votes: 2, amount: 1000, currency: 'NGN' };
// 10 + 2 bonus = 12 votes; ₦1000 = 100_000 kobo.
const FINGERPRINT = {
  contestId: 'contest-1', contestantId: 'ct-1', packageId: 'pkg-1',
  votes: 12, amountKobo: 100_000,
};

const BODY = {
  contestId: 'contest-1',
  contestantId: 'ct-1',
  packageId: 'pkg-1',
  voterEmail: 'v@x.com',
  voterName: 'Voter',
};

function walletRequest(userKey = 'idem-v1') {
  return makeRequest('/api/votes/paid/wallet', {
    body: BODY,
    headers: {
      authorization: 'Bearer tok',
      'idempotency-key': userKey,
    },
    ip: '203.0.113.71',
  }) as never;
}

interface StubOpts {
  packageRow?: unknown;
  txInsert?: { data: unknown; error: unknown };
  priorTx?: unknown;
  priorTxErr?: unknown;
  voteInsertErr?: unknown;
  priorVote?: unknown;
}

/** Table-aware supabase stub covering every chain this route builds. */
function stubDb(opts: StubOpts = {}) {
  const packageRow = 'packageRow' in opts ? opts.packageRow : PKG;
  const txInsert = opts.txInsert ?? { data: { id: 'tx-1' }, error: null };
  const priorTx = 'priorTx' in opts ? opts.priorTx : null;
  const priorVote = 'priorVote' in opts ? opts.priorVote : { id: 'v-1' };
  const calls = { votesInserts: [] as Record<string, unknown>[], txUpdates: [] as Record<string, unknown>[] };

  const from = vi.fn((table: string) => {
    if (table === 'vote_packages') {
      const maybeSingle = async () => ({ data: packageRow, error: null });
      const chain: Record<string, unknown> = { maybeSingle };
      chain.eq = () => chain;
      return { select: () => chain };
    }
    if (table === 'vote_transactions') {
      return {
        insert: () => ({ select: () => ({ single: async () => txInsert }) }),
        select: () => {
          const maybeSingle = async () => ({ data: priorTx, error: opts.priorTxErr ?? null });
          const chain: Record<string, unknown> = { maybeSingle };
          chain.eq = () => chain;
          return chain;
        },
        update: (row: Record<string, unknown>) => {
          calls.txUpdates.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
    }
    if (table === 'votes') {
      return {
        insert: (row: Record<string, unknown>) => {
          calls.votesInserts.push(row);
          return Promise.resolve({ error: opts.voteInsertErr ?? null });
        },
        select: () => {
          const maybeSingle = async () => ({ data: priorVote, error: null });
          const chain: Record<string, unknown> = { maybeSingle };
          chain.eq = () => chain;
          return chain;
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return calls;
}

const PRIOR_CREDITED = {
  id: 'tx-prior',
  payment_reference: 'WVOTE-prior',
  total_votes_to_credit: 12,
  amount_expected: 1000,
  vote_credit_status: 'credited',
  contest_id: 'contest-1',
  contestant_id: 'ct-1',
  voter_user_id: 'u-v1',
  votes_purchased: 10,
  bonus_votes: 2,
};

/** A replay's debit is a ledger no-op — the bound key is already consumed. */
function stubReplayDebit() {
  vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: true, amountKobo: 100_000 } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubDb();
});

describe('POST /api/votes/paid/wallet', () => {
  it('requires the Idempotency-Key header', async () => {
    const res = await POST(makeRequest('/api/votes/paid/wallet', {
      body: BODY,
      headers: { authorization: 'Bearer tok' },
      ip: '203.0.113.71',
    }) as never);
    expect(res.status).toBe(400);
    expect(vi.mocked(debitWallet)).not.toHaveBeenCalled();
  });

  it('debits and credits with a user+payload-bound idempotency key', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1' } as never);
    const calls = stubDb();
    const res = await POST(walletRequest());
    expect(res.status).toBe(201);
    const key = boundClaimKey('wallet-vote', 'u-v1', 'idem-v1', FINGERPRINT);
    expect(vi.mocked(debitWallet)).toHaveBeenCalledWith('u-v1',
      expect.objectContaining({ idempotencyKey: key, amountKobo: 100_000 }));
    expect(calls.votesInserts).toHaveLength(1);
    expect(vi.mocked(incrementVoteTotals)).toHaveBeenCalledWith('contest-1', 'ct-1',
      { paidVotes: 10, bonusVotes: 2 });
  });

  it('the same raw key under another user produces a different ledger key', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1-a' } as never);
    await POST(walletRequest());
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1-b' } as never);
    await POST(walletRequest());
    const keys = vi.mocked(debitWallet).mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(boundClaimKey('wallet-vote', 'u-v1-a', 'idem-v1', FINGERPRINT));
    expect(keys[1]).toBe(boundClaimKey('wallet-vote', 'u-v1-b', 'idem-v1', FINGERPRINT));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('reverses the debit and marks the tx reversed when fulfilment fails', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1-fail' } as never);
    const calls = stubDb({ voteInsertErr: { message: 'votes insert exploded' } });
    const res = await POST(walletRequest('idem-fail'));
    expect(res.status).toBe(500);
    const key = boundClaimKey('wallet-vote', 'u-v1-fail', 'idem-fail', FINGERPRINT);
    expect(vi.mocked(reverseWalletDebit)).toHaveBeenCalledWith('u-v1-fail',
      expect.objectContaining({ idempotencyKey: `rev:${key}`, amountKobo: 100_000 }));
    expect(calls.txUpdates).toEqual([{ vote_credit_status: 'reversed' }]);
    expect(vi.mocked(incrementVoteTotals)).not.toHaveBeenCalled();
  });

  it('flags reconciliation when fulfilment AND the reversal both fail', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1-stuck' } as never);
    stubDb({ voteInsertErr: { message: 'votes insert exploded' } });
    vi.mocked(reverseWalletDebit).mockRejectedValueOnce(new Error('ledger down'));
    const res = await POST(walletRequest('idem-stuck'));
    expect(res.status).toBe(500);
    const key = boundClaimKey('wallet-vote', 'u-v1-stuck', 'idem-stuck', FINGERPRINT);
    expect(vi.mocked(enqueueOutboxEvent)).toHaveBeenCalledWith(
      'votes.wallet.reversal_failed',
      expect.objectContaining({
        idempotencyKey: key,
        clientIdempotencyKey: 'idem-stuck',
        transactionId: 'tx-1',
        costKobo: 100_000,
      }),
    );
  });

  it('replay of a fully credited purchase returns alreadyProcessed', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1' } as never);
    stubReplayDebit();
    const calls = stubDb({
      txInsert: { data: null, error: { code: '23505' } },
      priorTx: PRIOR_CREDITED,
      priorVote: { id: 'v-prior' },
    });
    const res = await POST(walletRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyProcessed).toBe(true);
    expect(body.transactionId).toBe('tx-prior');
    expect(calls.votesInserts).toHaveLength(0);
  });

  it('replay of a credited-but-unfulfilled purchase self-heals the votes row', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1' } as never);
    stubReplayDebit();
    const calls = stubDb({
      txInsert: { data: null, error: { code: '23505' } },
      priorTx: PRIOR_CREDITED,
      priorVote: null,
    });
    const res = await POST(walletRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyProcessed).toBe(true);
    expect(calls.votesInserts).toHaveLength(1);
    expect(calls.votesInserts[0]).toEqual(expect.objectContaining({
      transaction_id: 'tx-prior',
      voter_user_id: 'u-v1',
      vote_quantity: 12,
    }));
    // The recorded split is preserved — bonus must not fold into paid.
    expect(vi.mocked(incrementVoteTotals)).toHaveBeenCalledWith('contest-1', 'ct-1',
      { paidVotes: 10, bonusVotes: 2 });
  });

  it('replay whose heal insert loses the unique race is fulfilment, not failure', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1' } as never);
    stubReplayDebit();
    // priorVote:null then insert 23505 = a concurrent replay already wrote the row.
    const calls = stubDb({
      txInsert: { data: null, error: { code: '23505' } },
      priorTx: PRIOR_CREDITED,
      priorVote: null,
      voteInsertErr: { code: '23505', message: 'uq_votes_paid_transaction' },
    });
    const res = await POST(walletRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyProcessed).toBe(true);
    // The winner already incremented — the loser must not double-count.
    expect(vi.mocked(incrementVoteTotals)).not.toHaveBeenCalled();
    expect(vi.mocked(reverseWalletDebit)).not.toHaveBeenCalled();
    expect(calls.votesInserts).toHaveLength(1);
  });

  it('replay of a refunded purchase is a spent-key 409 (no re-fulfilment)', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1' } as never);
    stubReplayDebit();
    const calls = stubDb({
      txInsert: { data: null, error: { code: '23505' } },
      priorTx: { ...PRIOR_CREDITED, vote_credit_status: 'reversed' },
    });
    const res = await POST(walletRequest());
    expect(res.status).toBe(409);
    expect(calls.votesInserts).toHaveLength(0);
    expect(vi.mocked(reverseWalletDebit)).not.toHaveBeenCalled();
  });

  it('replay after a successful compensation is a spent-key 409 — never free votes', async () => {
    // Prior attempt: debit posted, tx insert failed, rev:<key> reversal posted.
    // Retry under the same key must NOT reach the tx insert — the money went
    // back, so fulfilling now would credit votes against ₦0 held.
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'u-v1-refund' } as never);
    stubReplayDebit();
    vi.mocked(checkIdempotencyKey).mockResolvedValue({ alreadyProcessed: true, amountKobo: 100_000 } as never);
    const calls = stubDb();
    const res = await POST(walletRequest('idem-refunded'));
    expect(res.status).toBe(409);
    expect(vi.mocked(checkIdempotencyKey)).toHaveBeenCalledWith(
      `rev:${boundClaimKey('wallet-vote', 'u-v1-refund', 'idem-refunded', FINGERPRINT)}`,
    );
    expect(calls.votesInserts).toHaveLength(0);
  });
});
