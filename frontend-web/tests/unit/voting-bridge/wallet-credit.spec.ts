/**
 * creditWalletVotes replay/heal semantics — pins the two cases that decide
 * whether a same-key replay completes a purchase or corrupts it:
 *
 *  - a 'credited' prior transaction with a missing votes row is healed
 *    (insert + totals), never reported as bare success;
 *  - a heal insert that loses the uq_votes_paid_transaction race to a
 *    concurrent same-key caller is fulfilment-by-the-other-caller — it must
 *    NOT throw, because the route turns a throw into a debit reversal and
 *    would refund a purchase that was just delivered;
 *  - a 'reversed' prior transaction is a spent key — 409, never re-fulfilled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/src/lib/api/responses';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({ incrementVoteTotals: vi.fn(async () => undefined) }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn(async () => undefined) }));

import { creditWalletVotes } from '@/src/server/voting-bridge/wallet-credit';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { createAdminClient } from '@/lib/supabase/server';

const P = {
  contestId: 'contest-1',
  contestantId: 'ct-1',
  userId: 'u-credit',
  voterEmail: 'v@x.com',
  voteCount: 50,
  costKobo: 500_000,
  idempotencyKey: 'wallet-vote:u-credit:idem:fp',
  ip: '203.0.113.9',
  userAgent: 'test',
};

const PRIOR = {
  id: 'tx-prior',
  payment_reference: 'WVOTE-prior',
  total_votes_to_credit: 50,
  vote_credit_status: 'credited',
};

interface StubOpts {
  priorTx?: unknown;
  voteRow?: unknown;            // first select result (dedupe seam)
  voteRowAfterRace?: unknown;   // re-read result after a 23505 insert
  voteInsertErr?: unknown;
}

function stubDb(opts: StubOpts = {}) {
  const priorTx = 'priorTx' in opts ? opts.priorTx : PRIOR;
  const voteRow = 'voteRow' in opts ? opts.voteRow : null;
  const voteRowAfterRace = 'voteRowAfterRace' in opts ? opts.voteRowAfterRace : voteRow;
  const calls = { votesInserts: [] as Record<string, unknown>[] };
  let voteReads = 0;

  const from = vi.fn((table: string) => {
    if (table === 'vote_transactions') {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { code: '23505' } }),
          }),
        }),
        select: () => {
          const maybeSingle = async () => ({ data: priorTx, error: null });
          const chain: Record<string, unknown> = { maybeSingle };
          chain.eq = () => chain;
          return chain;
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
          const maybeSingle = async () => {
            voteReads += 1;
            return { data: voteReads === 1 ? voteRow : voteRowAfterRace, error: null };
          };
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('creditWalletVotes — replay under a bound key', () => {
  it('heals a credited transaction whose votes row never landed', async () => {
    const calls = stubDb({ voteRow: null });
    const res = await creditWalletVotes(P);
    expect(res.alreadyProcessed).toBe(true);
    expect(res.transactionId).toBe('tx-prior');
    expect(calls.votesInserts).toHaveLength(1);
    expect(vi.mocked(incrementVoteTotals)).toHaveBeenCalledWith('contest-1', 'ct-1', { paidVotes: 50 });
  });

  it('a heal insert that loses the unique race returns alreadyProcessed, not an error', async () => {
    stubDb({
      voteRow: null,
      voteInsertErr: { code: '23505' },
      voteRowAfterRace: { id: 'v-winner' }, // the other caller's row is now visible
    });
    const res = await creditWalletVotes(P);
    expect(res.alreadyProcessed).toBe(true);
    // The winner incremented totals — the loser must not double-count.
    expect(vi.mocked(incrementVoteTotals)).not.toHaveBeenCalled();
  });

  it('still throws (reversible) when the 23505 is NOT the transaction dedupe', async () => {
    stubDb({
      voteRow: null,
      voteInsertErr: { code: '23505' },
      voteRowAfterRace: null, // nothing actually landed — a different constraint fired
    });
    await expect(creditWalletVotes(P)).rejects.toThrowError(ApiError);
  });

  it('rejects replay of a refunded purchase with a spent-key 409', async () => {
    const calls = stubDb({ priorTx: { ...PRIOR, vote_credit_status: 'reversed' } });
    await expect(creditWalletVotes(P)).rejects.toThrowError(/refunded/i);
    expect(calls.votesInserts).toHaveLength(0);
  });
});
