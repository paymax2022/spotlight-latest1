/**
 * UAT Batch 8 (SEC-005/G-MC) — sensitive-actions.service.ts.
 *
 * These are the extracted core bodies of the three routes that used to
 * execute directly (votes/[voteId]/reverse, [contestId]/adjust,
 * rounds/[roundId]/publish-results). This file migrates the execution-time
 * assertions that used to live in those routes' own test files (now
 * propose-only) — vote-not-found/already-reversed guards, wallet-refund
 * idempotency, adjustment delta correctness, and publish-results'
 * already-published/no-data guards and prize mapping — onto the extracted
 * `execute*` functions directly, proving the refactor preserved behavior
 * exactly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({
  incrementVoteTotals: vi.fn(),
  recomputeRanks: vi.fn(),
  getVoteTotals: vi.fn(),
}));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ reverseWalletDebit: vi.fn() }));
vi.mock('@/src/server/voting-bridge/leaderboard-ranks', () => ({ bridgedRecomputeRanksForResults: vi.fn() }));

import {
  executeVoteReversal,
  executeVoteAdjustment,
  executeResultsPublish,
} from '@/src/server/voting/sensitive-actions.service';
import { createAdminClient } from '@/lib/supabase/server';
import { incrementVoteTotals, recomputeRanks, getVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { reverseWalletDebit } from '@/src/server/wallet/service';
import { bridgedRecomputeRanksForResults } from '@/src/server/voting-bridge/leaderboard-ranks';
import { makeSupabaseMock } from '../golden-path/_fixtures';

const CHECKER_IDENTITY = { actorId: 'checker-1', role: 'super_admin' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recomputeRanks).mockResolvedValue(undefined as any);
  vi.mocked(incrementVoteTotals).mockResolvedValue(undefined as any);
});

// ---------------------------------------------------------------------------
// executeVoteReversal
// ---------------------------------------------------------------------------

describe('executeVoteReversal', () => {
  it('throws a 404 ApiError when the vote does not exist', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(executeVoteReversal('missing', 'Fraud', CHECKER_IDENTITY)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws a 400 ApiError when the vote is already reversed', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({
      data: { id: 'vote-1', vote_status: 'reversed', vote_quantity: 10, contest_id: 'c1', contestant_id: 'k1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(executeVoteReversal('vote-1', 'Duplicate', CHECKER_IDENTITY)).rejects.toMatchObject({ status: 400 });
  });

  it('reverses a confirmed vote and reports the reversed quantity', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({
      data: {
        id: 'vote-1', vote_status: 'confirmed', vote_quantity: 12,
        contest_id: 'c1', contestant_id: 'k1', transaction_id: null,
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const result = await executeVoteReversal('vote-1', 'Fraud reversal confirmed', CHECKER_IDENTITY);

    expect(result.voteId).toBe('vote-1');
    expect(result.reversedQuantity).toBe(12);
    expect(result.walletRefund.refunded).toBe(false); // no transaction_id -> no refund path
    expect(vi.mocked(appendAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'checker-1',
        actorRole: 'super_admin',
        action: 'vote_reversed',
        entityId: 'vote-1',
      }),
    );
  });

  it('refunds the wallet via reverseWalletDebit for a wallet-paid vote (once)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle
      .mockResolvedValueOnce({
        data: {
          id: 'vote-1', vote_status: 'confirmed', vote_quantity: 12,
          contest_id: 'c1', contestant_id: 'k1', transaction_id: 'tx-1',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'tx-1', payment_provider: 'wallet', payment_reference: 'ref-1', amount_paid: 500, voter_user_id: 'u1' },
        error: null,
      });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 50_000 } as any);

    const result = await executeVoteReversal('vote-1', 'Fraud reversal confirmed', CHECKER_IDENTITY);

    expect(result.walletRefund.refunded).toBe(true);
    expect(result.walletRefund.amountKobo).toBe(50_000); // ₦500 → kobo
    expect(vi.mocked(reverseWalletDebit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reverseWalletDebit)).toHaveBeenCalledWith('u1', expect.objectContaining({
      amountKobo: 50_000,
      idempotencyKey: 'vote-reversal-refund:tx-1',
    }));
  });

  it('does not refund a non-wallet (Paystack) vote', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle
      .mockResolvedValueOnce({
        data: { id: 'vote-1', vote_status: 'confirmed', vote_quantity: 5, contest_id: 'c1', contestant_id: 'k1', transaction_id: 'tx-1' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'tx-1', payment_provider: 'paystack', payment_reference: 'ref-1', amount_paid: 500, voter_user_id: 'u1' },
        error: null,
      });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const result = await executeVoteReversal('vote-1', 'Fraud reversal confirmed', CHECKER_IDENTITY);

    expect(result.walletRefund.refunded).toBe(false);
    expect(vi.mocked(reverseWalletDebit)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// executeVoteAdjustment
// ---------------------------------------------------------------------------

describe('executeVoteAdjustment', () => {
  it('add: increments totals by exactly voteQuantity and reports the real before/after totals', async () => {
    vi.mocked(getVoteTotals)
      .mockResolvedValueOnce({ totalConfirmedVotes: 100 } as any)
      .mockResolvedValueOnce({ totalConfirmedVotes: 150 } as any);
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const result = await executeVoteAdjustment(
      { contestId: 'contest-1', contestantId: 'contestant-1', adjustmentType: 'add', voteQuantity: 50, reason: 'Manual correction' },
      CHECKER_IDENTITY,
    );

    expect(result).toMatchObject({ beforeTotal: 100, afterTotal: 150, adjustment: 50 });
    expect(incrementVoteTotals).toHaveBeenCalledWith('contest-1', 'contestant-1', { adminAdjustmentVotes: 50 });
    expect(vi.mocked(appendAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'checker-1', action: 'admin_vote_adjustment' }),
    );
  });

  it('subtract: applies a reversedVotes delta, not a raw negative add', async () => {
    vi.mocked(getVoteTotals)
      .mockResolvedValueOnce({ totalConfirmedVotes: 100 } as any)
      .mockResolvedValueOnce({ totalConfirmedVotes: 80 } as any);
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await executeVoteAdjustment(
      { contestId: 'contest-1', contestantId: 'contestant-1', adjustmentType: 'subtract', voteQuantity: 20, reason: 'Fraud reversal' },
      CHECKER_IDENTITY,
    );
    expect(incrementVoteTotals).toHaveBeenCalledWith('contest-1', 'contestant-1', { reversedVotes: 20 });
  });
});

// ---------------------------------------------------------------------------
// executeResultsPublish
// ---------------------------------------------------------------------------

function makePublishSupabase(opts: {
  round?: any;
  prizeRows?: any[];
  insertedRows?: any[];
  rpcError?: any;
  contestantRows?: any[];
}) {
  const calls: any = {};

  function roundsChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: opts.round ?? null, error: null }),
    };
    return chain;
  }
  function prizesChain() {
    const chain: any = {
      select: () => chain,
      eq: () => Promise.resolve({ data: opts.prizeRows ?? [], error: null }),
    };
    return chain;
  }
  function contestantsChain() {
    const chain: any = {
      select: () => chain,
      in: () => Promise.resolve({ data: opts.contestantRows ?? [], error: null }),
    };
    return chain;
  }

  const rpc = vi.fn().mockImplementation((name: string, args: any) => {
    calls.rpcName = name;
    calls.rpcArgs = args;
    if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError });
    return Promise.resolve({ data: opts.insertedRows ?? [], error: null });
  });

  const client: any = {
    from: (table: string) => {
      if (table === 'voting_rounds') return roundsChain();
      if (table === 'voting_contest_prizes') return prizesChain();
      if (table === 'contestants') return contestantsChain();
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc,
  };

  return { client, calls };
}

describe('executeResultsPublish', () => {
  it('throws a 404 ApiError when the round does not exist', async () => {
    const { client } = makePublishSupabase({ round: null });
    vi.mocked(createAdminClient).mockReturnValue(client);

    await expect(executeResultsPublish('round-1', CHECKER_IDENTITY)).rejects.toMatchObject({ status: 404 });
  });

  it('throws a 409 ApiError when the round is already published', async () => {
    const { client } = makePublishSupabase({ round: { id: 'round-1', contest_id: 'contest-1', status: 'results_published' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    await expect(executeResultsPublish('round-1', CHECKER_IDENTITY)).rejects.toMatchObject({ status: 409 });
    expect(bridgedRecomputeRanksForResults).not.toHaveBeenCalled();
  });

  it('throws a 400 ApiError when there is no leaderboard data to publish', async () => {
    const { client } = makePublishSupabase({ round: { id: 'round-1', contest_id: 'contest-1', status: 'active' } });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(bridgedRecomputeRanksForResults).mockResolvedValue([]);

    await expect(executeResultsPublish('round-1', CHECKER_IDENTITY)).rejects.toMatchObject({ status: 400 });
  });

  it('happy path: publishes results, maps prizes by rank, logs audit, returns tieBreakRule', async () => {
    const round = { id: 'round-1', contest_id: 'contest-1', status: 'active', name: 'Finale' };
    const prizeRows = [
      { id: 'prize-1', position: 1 },
      { id: 'prize-2', position: 2 },
    ];
    const ranks = [
      { contestantId: 'enr-A', rank: 1, totalConfirmedVotes: 100, paidVotes: 60 },
      { contestantId: 'enr-B', rank: 2, totalConfirmedVotes: 80, paidVotes: 20 },
      { contestantId: 'enr-C', rank: 3, totalConfirmedVotes: 10, paidVotes: 0 },
    ];
    const insertedRows = [
      { contestant_id: 'enr-A', rank: 1, total_confirmed_votes: 100, paid_votes: 60, prize_id: 'prize-1' },
      { contestant_id: 'enr-B', rank: 2, total_confirmed_votes: 80, paid_votes: 20, prize_id: 'prize-2' },
      { contestant_id: 'enr-C', rank: 3, total_confirmed_votes: 10, paid_votes: 0, prize_id: null },
    ];
    const contestantRows = [
      { id: 'enr-A', name: 'Contestant A' },
      { id: 'enr-B', name: 'Contestant B' },
      { id: 'enr-C', name: 'Contestant C' },
    ];
    const { client, calls } = makePublishSupabase({ round, prizeRows, insertedRows, contestantRows });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(bridgedRecomputeRanksForResults).mockResolvedValue(ranks);

    const result = await executeResultsPublish('round-1', CHECKER_IDENTITY);

    expect(calls.rpcName).toBe('publish_voting_round_results');
    expect(calls.rpcArgs.p_results).toEqual([
      { contestant_id: 'enr-A', rank: 1, total_confirmed_votes: 100, paid_votes: 60, prize_id: 'prize-1' },
      { contestant_id: 'enr-B', rank: 2, total_confirmed_votes: 80, paid_votes: 20, prize_id: 'prize-2' },
      { contestant_id: 'enr-C', rank: 3, total_confirmed_votes: 10, paid_votes: 0, prize_id: null },
    ]);
    expect(calls.rpcArgs.p_published_by).toBe('checker-1');

    expect(result.tieBreakRule).toBe('total_confirmed_votes DESC, paid_votes DESC, last_vote_at ASC');
    expect(result.results).toHaveLength(3);
    expect(result.results[2].prizeId).toBeNull();
    expect(result.results[0].contestantName).toBe('Contestant A');

    expect(appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'voting_round_results_locked',
        entityType: 'voting_round',
        entityId: 'round-1',
        contestId: 'contest-1',
        newValue: expect.objectContaining({ contestantCount: 3, topContestantId: 'enr-A' }),
      }),
    );
  });

  it('maps a race-condition already-published RPC error to 409', async () => {
    const round = { id: 'round-1', contest_id: 'contest-1', status: 'active' };
    const { client } = makePublishSupabase({
      round,
      prizeRows: [],
      rpcError: { message: 'voting_round_already_published' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(bridgedRecomputeRanksForResults).mockResolvedValue([
      { contestantId: 'enr-A', rank: 1, totalConfirmedVotes: 5, paidVotes: 0 },
    ]);

    await expect(executeResultsPublish('round-1', CHECKER_IDENTITY)).rejects.toMatchObject({ status: 409 });
  });
});
