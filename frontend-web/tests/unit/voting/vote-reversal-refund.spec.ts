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
// (B) ROUTE: real handler — PROPOSE behavior only (UAT Batch 8, SEC-005/G-MC)
//
// The route no longer executes a reversal directly — it only proposes one via
// contest_admin_approvals (dual control). The vote-lookup / already-reversed /
// wallet-refund assertions that used to live here now target
// executeVoteReversal directly in sensitive-actions-service.test.ts, which is
// where that behavior actually lives post-refactor.
// ---------------------------------------------------------------------------

vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

import { POST as postReverse } from '../../../app/api/admin/voting/votes/[voteId]/reverse/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { makeSupabaseMock, chainableInsert } from '../golden-path/_fixtures';

function withParams(voteId: string) {
  return { params: Promise.resolve({ voteId }) };
}

describe('POST /api/admin/voting/votes/{voteId}/reverse (route, propose-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
  });

  it('rejects a reason shorter than 5 chars (400) — still validated before proposing', async () => {
    const req = makeRequest('/api/admin/voting/votes/vote-1/reverse', { body: { reason: 'ok' } });
    const res = await postReverse(req, withParams('vote-1'));
    expect(res.status).toBe(400);
  });

  it('proposes a pending approval (202) instead of executing the reversal', async () => {
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockReturnValue(chainableInsert({ id: 'approval-1', status: 'pending_approval' }));
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const req = makeRequest('/api/admin/voting/votes/vote-1/reverse', {
      body: { reason: 'Fraud reversal confirmed' },
    });
    const res = await postReverse(req, withParams('vote-1'));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.success).toBe(true);
    expect(body.approvalId).toBe('approval-1');
    expect(body.status).toBe('pending_approval');

    // The proposal carries the validated payload; nothing has executed.
    const insertedRow = insertFn.mock.calls[0][0] as any;
    expect(insertedRow.action_type).toBe('vote_reversal');
    expect(insertedRow.payload).toMatchObject({ voteId: 'vote-1', reason: 'Fraud reversal confirmed' });
    expect(insertedRow.initiator_id).toBe('admin-1');
  });

  it('never looks up the vote at propose time — that happens at execute (approve) time only', async () => {
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockReturnValue(chainableInsert({ id: 'approval-2', status: 'pending_approval' }));
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const req = makeRequest('/api/admin/voting/votes/vote-missing/reverse', {
      body: { reason: 'Fraudulent activity detected' },
    });
    const res = await postReverse(req, withParams('vote-missing'));

    // Propose succeeds regardless of whether vote-missing actually exists —
    // existence is checked by executeVoteReversal at approve time.
    expect(res.status).toBe(202);
  });
});
