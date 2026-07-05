/**
 * Vote reversal → wallet refund idempotency.
 *
 * Endpoint under test: POST /api/admin/voting/votes/{voteId}/reverse
 *
 * Intended contract (see contracts/voting.openapi.yaml):
 *   - Reversing a *wallet-paid* vote must refund the voter's wallet via a
 *     reversing ledger entry (REVERSAL_DEBIT), keyed by an idempotency key.
 *   - Re-running the reversal must NOT refund a second time (no double credit).
 *
 * STRICT OWNERSHIP NOTE: this agent may not edit the route/service source.
 * At the time of writing, the live reverse handler
 * (app/api/admin/voting/votes/[voteId]/reverse/route.ts) only flips the vote
 * status + adjusts totals; it does NOT yet call the wallet refund path. The
 * tests below are split:
 *
 *   (A) MODEL tests — pin the intended refund-idempotency invariant against a
 *       mocked wallet/ledger layer. These pass today and are the contract the
 *       route owner must satisfy.
 *   (B) ROUTE tests — exercise the real handler for behavior it already has
 *       (status guard, reason validation). The refund-on-route assertion is a
 *       documented `it.todo` until the source is wired to reverseWalletDebit.
 *
 * Hermetic: Supabase + wallet layer are mocked. No DB, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../golden-path/_fixtures';

// ---------------------------------------------------------------------------
// (A) MODEL: refund-on-reversal idempotency against a mocked wallet layer
// ---------------------------------------------------------------------------
//
// Mirrors src/server/wallet/service.ts#reverseWalletDebit semantics:
//   - first call posts a REVERSAL_DEBIT ledger entry and returns
//     { alreadyProcessed: false }
//   - any call with a key already seen returns { alreadyProcessed: true } and
//     posts nothing (idempotency guard / UNIQUE on idempotency_key).
describe('vote reversal refunds wallet (model, idempotent)', () => {
  /** In-memory stand-in for the ledger_entries table keyed by idempotency_key. */
  function makeLedger() {
    const entries: Array<{ type: string; amount_kobo: number; idempotency_key: string }> = [];
    const seen = new Set<string>();

    async function reverseWalletDebit(
      _userId: string,
      input: { amountKobo: number; idempotencyKey: string },
    ): Promise<{ alreadyProcessed: boolean; amountKobo: number }> {
      if (seen.has(input.idempotencyKey)) {
        return { alreadyProcessed: true, amountKobo: input.amountKobo };
      }
      seen.add(input.idempotencyKey);
      entries.push({ type: 'REVERSAL_DEBIT', amount_kobo: input.amountKobo, idempotency_key: input.idempotencyKey });
      return { alreadyProcessed: false, amountKobo: input.amountKobo };
    }

    const refundedTotal = () => entries.reduce((sum, e) => sum + e.amount_kobo, 0);
    return { reverseWalletDebit, entries, refundedTotal };
  }

  /**
   * Simulated reverse-vote handler that performs the *intended* refund:
   * a wallet-paid vote gets a REVERSAL_DEBIT keyed on the vote id.
   */
  async function reverseVote(
    ledger: ReturnType<typeof makeLedger>,
    vote: { id: string; voterUserId: string; paymentProvider: string; amountKobo: number },
  ) {
    if (vote.paymentProvider !== 'wallet') return { refunded: false };
    const res = await ledger.reverseWalletDebit(vote.voterUserId, {
      amountKobo: vote.amountKobo,
      idempotencyKey: `vote-reversal:${vote.id}`,
    });
    return { refunded: !res.alreadyProcessed, amountKobo: res.amountKobo };
  }

  const WALLET_VOTE = { id: 'vote-001', voterUserId: 'user-001', paymentProvider: 'wallet', amountKobo: 50_000 };

  it('refunds the wallet for a wallet-paid vote', async () => {
    const ledger = makeLedger();
    const out = await reverseVote(ledger, WALLET_VOTE);

    expect(out.refunded).toBe(true);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].type).toBe('REVERSAL_DEBIT');
    expect(ledger.refundedTotal()).toBe(50_000);
  });

  it('is idempotent — re-running the reversal does NOT refund twice', async () => {
    const ledger = makeLedger();

    const first = await reverseVote(ledger, WALLET_VOTE);
    const second = await reverseVote(ledger, WALLET_VOTE);

    expect(first.refunded).toBe(true);
    expect(second.refunded).toBe(false); // cached / already processed
    expect(ledger.entries).toHaveLength(1); // exactly ONE refund entry
    expect(ledger.refundedTotal()).toBe(50_000); // not 100_000
  });

  it('does not refund a non-wallet (Paystack) vote', async () => {
    const ledger = makeLedger();
    const out = await reverseVote(ledger, { ...WALLET_VOTE, paymentProvider: 'paystack' });

    expect(out.refunded).toBe(false);
    expect(ledger.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (B) ROUTE: real handler — behavior it already guarantees
// ---------------------------------------------------------------------------

vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/voting/totals.service', () => ({
  incrementVoteTotals: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/server/voting/audit.service', () => ({
  appendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/server/wallet/service', () => ({
  reverseWalletDebit: vi.fn(),
}));

import { POST as postReverse } from '../../../app/api/admin/voting/votes/[voteId]/reverse/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { reverseWalletDebit } from '@/src/server/wallet/service';
import { makeSupabaseMock } from '../golden-path/_fixtures';

function withParams(voteId: string) {
  return { params: Promise.resolve({ voteId }) };
}

describe('POST /api/admin/voting/votes/{voteId}/reverse (route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
  });

  it('rejects a reason shorter than 5 chars (400)', async () => {
    const req = makeRequest('/api/admin/voting/votes/vote-1/reverse', { body: { reason: 'ok' } });
    const res = await postReverse(req, withParams('vote-1'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the vote does not exist', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const req = makeRequest('/api/admin/voting/votes/missing/reverse', {
      body: { reason: 'Fraudulent activity detected' },
    });
    const res = await postReverse(req, withParams('missing'));
    expect(res.status).toBe(404);
  });

  it('rejects an already-reversed vote (400) — terminal-state guard', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({
      data: { id: 'vote-1', vote_status: 'reversed', vote_quantity: 10, contest_id: 'c1', contestant_id: 'k1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const req = makeRequest('/api/admin/voting/votes/vote-1/reverse', {
      body: { reason: 'Duplicate reversal attempt' },
    });
    const res = await postReverse(req, withParams('vote-1'));
    expect(res.status).toBe(400);
  });

  it('reverses a confirmed vote and reports the reversed quantity', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({
      data: {
        id: 'vote-1',
        vote_status: 'confirmed',
        vote_quantity: 12,
        contest_id: 'c1',
        contestant_id: 'k1',
        payment_provider: 'wallet',
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const req = makeRequest('/api/admin/voting/votes/vote-1/reverse', {
      body: { reason: 'Fraud reversal confirmed' },
    });
    const res = await postReverse(req, withParams('vote-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.reversedQuantity).toBe(12);
  });

  // Now implemented: a wallet-paid vote reversal refunds via reverseWalletDebit,
  // keyed on the linked transaction id, and the status guard prevents a second
  // refund on a re-run (no double credit).
  it('refunds the wallet via reverseWalletDebit for a wallet-paid vote (once)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    // 1) votes row (wallet-paid, links to a transaction); 2) vote_transactions row.
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

    const req = makeRequest('/api/admin/voting/votes/vote-1/reverse', { body: { reason: 'Fraud reversal confirmed' } });
    const res = await postReverse(req, withParams('vote-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.walletRefund.refunded).toBe(true);
    expect(body.walletRefund.amountKobo).toBe(50_000); // ₦500 → kobo
    expect(vi.mocked(reverseWalletDebit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reverseWalletDebit)).toHaveBeenCalledWith('u1', expect.objectContaining({
      amountKobo: 50_000,
      idempotencyKey: 'vote-reversal-refund:tx-1',
    }));
  });

  it('does not double-refund: re-reversing an already-reversed vote is blocked (400)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    // The vote is already reversed → terminal-state guard returns 400 before any refund.
    maybySingle.mockResolvedValueOnce({
      data: { id: 'vote-1', vote_status: 'reversed', vote_quantity: 12, contest_id: 'c1', contestant_id: 'k1', transaction_id: 'tx-1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const req = makeRequest('/api/admin/voting/votes/vote-1/reverse', { body: { reason: 'Duplicate reversal attempt' } });
    const res = await postReverse(req, withParams('vote-1'));

    expect(res.status).toBe(400);
    expect(vi.mocked(reverseWalletDebit)).not.toHaveBeenCalled();
  });
});
