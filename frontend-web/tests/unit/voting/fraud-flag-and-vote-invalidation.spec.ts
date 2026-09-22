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
 *      and calls `recomputeRanks` so the leaderboard rank reflects the
 *      invalidation immediately instead of going stale until the next
 *      unrelated recompute — an admin reviewing a fraud flag and then
 *      reversing the vote via this endpoint no longer leaves a
 *      momentarily-wrong rank. `recomputeRanks` failure is non-fatal — the
 *      reversal itself (already committed + audited) must not be undone by
 *      a best-effort rank refresh failing.
 *
 *      UAT Batch 8 (SEC-005/G-MC): this route now only PROPOSES the
 *      reversal (dual control) — the execution behavior described above
 *      (wallet refund, totals decrement, rank recompute, audit) lives in
 *      `executeVoteReversal` (sensitive-actions.service.ts) and runs at
 *      approve time. That behavior is covered in
 *      sensitive-actions-service.test.ts; this file now asserts the
 *      propose-time contract only.
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

  function primeProposeMock() {
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({ data: { id: 'approval-1', status: 'pending_approval' }, error: null }),
      }),
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    return { mock, insertFn };
  }

  it('proposes a pending approval (202) instead of executing — no totals/rank/audit/wallet touch at propose time', async () => {
    const { insertFn } = primeProposeMock();

    const res = await reverseVote(req('Confirmed bot-cluster vote, reversing per fraud review'), ctx());
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.approvalId).toBe('approval-1');
    expect(body.status).toBe('pending_approval');
    expect(incrementVoteTotals).not.toHaveBeenCalled();
    expect(recomputeRanks).not.toHaveBeenCalled();
    expect(appendAuditLog).not.toHaveBeenCalled();
    expect(reverseWalletDebit).not.toHaveBeenCalled();

    const insertedRow = insertFn.mock.calls[0][0] as any;
    expect(insertedRow.action_type).toBe('vote_reversal');
    expect(insertedRow.payload).toMatchObject({ voteId: 'vote-1', reason: 'Confirmed bot-cluster vote, reversing per fraud review' });
  });

  it('rejects a reason under 5 characters (400) without proposing anything', async () => {
    const { insertFn } = primeProposeMock();
    const res = await reverseVote(req('hi'), ctx());
    expect(res.status).toBe(400);
    expect(insertFn).not.toHaveBeenCalled();
    expect(incrementVoteTotals).not.toHaveBeenCalled();
    expect(recomputeRanks).not.toHaveBeenCalled();
  });

  it('401s without admin credentials', async () => {
    primeProposeMock();
    const res = await reverseVote(req('reason', { 'content-type': 'application/json' } as any), ctx());
    expect(res.status).toBe(401);
    expect(incrementVoteTotals).not.toHaveBeenCalled();
  });
});
