/**
 * VI-008: suspicious-vote review & invalidation (audited).
 *
 * Two DISTINCT, real endpoints make up the workflow — this suite tests both
 * and documents accurately what "invalidation" means today:
 *
 *   1. PATCH /api/admin/voting/[contestId]/fraud-alerts — resolves a fraud
 *      FLAG (status + free-text action_taken + audit log). This does NOT
 *      itself touch `votes` or `vote_totals` — it is bookkeeping on the flag,
 *      not a vote invalidation.
 *   2. POST /api/admin/voting/votes/[voteId]/reverse — the actual
 *      invalidation: marks the vote `reversed`, refunds a wallet-funded
 *      purchase (idempotent), decrements totals via `incrementVoteTotals`,
 *      and (as of this pass) calls `recomputeRanks` so the leaderboard rank
 *      reflects the invalidation immediately instead of going stale until
 *      the next unrelated recompute — an admin reviewing a fraud flag and
 *      then reversing the vote via this endpoint no longer leaves a
 *      momentarily-wrong rank. `recomputeRanks` failure is non-fatal — the
 *      reversal itself (already committed + audited) must not be undone by
 *      a best-effort rank refresh failing.
 *
 * A true ONE-CLICK "resolve flag -> vote is reversed in the same call" flow
 * does not exist (the two endpoints are separate, deliberately — resolving a
 * flag and reversing money/votes are different blast radii). That is a
 * legitimate product/maker-checker design question, not a bug; not built
 * here per the "no new subsystem" scope rule.
 *
 * fraud.service.ts, totals.service.ts, and audit.service.ts are hook-protected
 * (imported/mocked only, never edited). The two ROUTE files are NOT protected
 * — one (reverse/route.ts) was edited in this pass to add the recomputeRanks
 * call described above.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/server/voting/fraud.service', () => ({ resolveFraudFlag: vi.fn() }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({ incrementVoteTotals: vi.fn(), recomputeRanks: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ reverseWalletDebit: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));

import { PATCH } from '../../../app/api/admin/voting/[contestId]/fraud-alerts/route';
import { POST as reverseVote } from '../../../app/api/admin/voting/votes/[voteId]/reverse/route';
import { resolveFraudFlag } from '@/src/server/voting/fraud.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { incrementVoteTotals, recomputeRanks } from '@/src/server/voting/totals.service';
import { reverseWalletDebit } from '@/src/server/wallet/service';
import { createAdminClient } from '@/lib/supabase/server';

const ORIGINAL_ADMIN_KEY = process.env.SPOTLIGHT_ADMIN_API_KEY;

function adminHeaders(role = 'voting_manager') {
  return { 'x-admin-key': 'test-admin-key', 'x-admin-role': role, 'content-type': 'application/json' };
}

describe('PATCH /api/admin/voting/[contestId]/fraud-alerts — flag resolution is status+audit only (VI-008)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPOTLIGHT_ADMIN_API_KEY = 'test-admin-key';
    vi.mocked(resolveFraudFlag).mockResolvedValue(undefined as any);
    vi.mocked(appendAuditLog).mockResolvedValue(undefined as any);
  });

  function ctx() {
    return { params: Promise.resolve({ contestId: 'contest-1' }) };
  }
  function req(body: unknown, headers: Record<string, string> = adminHeaders()) {
    return new Request('http://localhost/api/admin/voting/contest-1/fraud-alerts', {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
  }

  it('resolves the flag and writes an audit log — does NOT touch votes/totals', async () => {
    const res = await PATCH(
      req({ flagId: 'flag-1', status: 'actioned', actionTaken: 'Confirmed bot cluster, votes reversed separately' }),
      ctx(),
    );
    expect(res.status).toBe(200);

    expect(resolveFraudFlag).toHaveBeenCalledWith(
      'flag-1',
      'system',
      'Confirmed bot cluster, votes reversed separately',
      'actioned',
    );
    expect(appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fraud_flag_resolved', entityType: 'fraud_flag', entityId: 'flag-1' }),
    );
    // The claim in the flag resolution itself never reverses votes/totals directly.
    expect(incrementVoteTotals).not.toHaveBeenCalled();
    expect(recomputeRanks).not.toHaveBeenCalled();
  });

  it('400s when required fields are missing', async () => {
    const res = await PATCH(req({ status: 'actioned', actionTaken: 'x' }), ctx()); // missing flagId
    expect(res.status).toBe(400);
    expect(resolveFraudFlag).not.toHaveBeenCalled();
  });

  it('401s without admin credentials', async () => {
    const res = await PATCH(
      req({ flagId: 'flag-1', status: 'actioned', actionTaken: 'x' }, { 'content-type': 'application/json' }),
      ctx(),
    );
    expect(res.status).toBe(401);
  });

  it('403s a role without votes:manage', async () => {
    const res = await PATCH(
      req({ flagId: 'flag-1', status: 'actioned', actionTaken: 'x' }, adminHeaders('content_manager')),
      ctx(),
    );
    expect(res.status).toBe(403);
    expect(resolveFraudFlag).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/voting/votes/[voteId]/reverse — the real invalidation path (VI-008)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPOTLIGHT_ADMIN_API_KEY = 'test-admin-key';
    vi.mocked(incrementVoteTotals).mockResolvedValue(undefined as any);
    vi.mocked(appendAuditLog).mockResolvedValue(undefined as any);
    vi.mocked(recomputeRanks).mockResolvedValue(undefined as any);
  });

  function ctx() {
    return { params: Promise.resolve({ voteId: 'vote-1' }) };
  }
  function req(reason: string | undefined, headers: Record<string, string> = adminHeaders()) {
    return new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    });
  }

  function primeVote(overrides: Partial<Record<string, unknown>> = {}) {
    const { mock, maybySingle, updateEq } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({
      data: {
        id: 'vote-1', contest_id: 'contest-1', contestant_id: 'enr-1',
        vote_status: 'confirmed', vote_quantity: 3, transaction_id: null,
        ...overrides,
      },
      error: null,
    });
    updateEq.mockResolvedValue({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    return { mock, maybySingle, updateEq };
  }

  it('marks the vote reversed, decrements totals, recomputes ranks, and audits — no wallet refund for a non-wallet vote', async () => {
    primeVote();

    const res = await reverseVote(req('Confirmed bot-cluster vote, reversing per fraud review'), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reversedQuantity).toBe(3);
    expect(incrementVoteTotals).toHaveBeenCalledWith('contest-1', 'enr-1', { reversedVotes: 3 });
    expect(recomputeRanks).toHaveBeenCalledWith('contest-1');
    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'vote_reversed', entityId: 'vote-1' }));
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });

  it('refunds the wallet when the vote was wallet-funded', async () => {
    const { mock, maybySingle } = primeVote({ transaction_id: 'tx-1' });
    maybySingle.mockResolvedValueOnce({
      data: { id: 'tx-1', payment_provider: 'wallet', payment_reference: 'ref-1', amount_paid: 500, voter_user_id: 'u-1' },
      error: null,
    });
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false } as any);

    const res = await reverseVote(req('Wallet-funded vote reversal'), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(reverseWalletDebit).toHaveBeenCalledWith('u-1', expect.objectContaining({
      amountKobo: 50000,
      idempotencyKey: 'vote-reversal-refund:tx-1',
    }));
    expect(body.walletRefund.refunded).toBe(true);
  });

  it('rejects a reason under 5 characters (400) without touching totals/ranks', async () => {
    primeVote();
    const res = await reverseVote(req('hi'), ctx());
    expect(res.status).toBe(400);
    expect(incrementVoteTotals).not.toHaveBeenCalled();
    expect(recomputeRanks).not.toHaveBeenCalled();
  });

  it('refuses to double-reverse an already-reversed vote (idempotency guard)', async () => {
    primeVote({ vote_status: 'reversed' });
    const res = await reverseVote(req('Trying to reverse again'), ctx());
    expect(res.status).toBe(400);
    expect(incrementVoteTotals).not.toHaveBeenCalled();
    expect(recomputeRanks).not.toHaveBeenCalled();
  });

  it('a recomputeRanks failure is non-fatal — the reversal itself still succeeds and is audited', async () => {
    primeVote();
    vi.mocked(recomputeRanks).mockRejectedValueOnce(new Error('RPC down'));

    const res = await reverseVote(req('Reversal should survive a rank-recompute hiccup'), ctx());
    expect(res.status).toBe(200);
    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'vote_reversed' }));
  });

  it('401s without admin credentials', async () => {
    primeVote();
    const res = await reverseVote(req('reason', { 'content-type': 'application/json' } as any), ctx());
    expect(res.status).toBe(401);
    expect(incrementVoteTotals).not.toHaveBeenCalled();
  });
});
