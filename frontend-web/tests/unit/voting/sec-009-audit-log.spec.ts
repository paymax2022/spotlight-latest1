/**
 * SEC-009: admin actions produce an attributable, append-only audit log
 * entry in `vote_audit_logs`.
 *
 * UAT Batch 8 (SEC-005/G-MC): POST /api/admin/voting/[contestId]/adjust and
 * POST /api/admin/voting/votes/[voteId]/reverse no longer execute directly —
 * they only PROPOSE a contest_admin_approvals row now (dual control), so
 * appendAuditLog is no longer called at propose time. The actual
 * 'admin_vote_adjustment' / 'vote_reversed' audit entries are written by
 * executeVoteAdjustment / executeVoteReversal at APPROVE (execute) time —
 * that invariant (real actor id, before/after values) is now covered by
 * sensitive-actions-service.test.ts, since that's where the behavior lives
 * post-refactor. This file now confirms the propose-time contract: no audit
 * entry yet, and the append-only shape of audit.service.ts itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock, chainableInsert } from '../golden-path/_fixtures';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({
  getVoteTotals: vi.fn(),
  incrementVoteTotals: vi.fn(),
}));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ reverseWalletDebit: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { POST as adjustPOST } from '../../../app/api/admin/voting/[contestId]/adjust/route';
import { POST as reversePOST } from '../../../app/api/admin/voting/votes/[voteId]/reverse/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getVoteTotals, incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { createAdminClient } from '@/lib/supabase/server';

function req(url: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('SEC-009: admin actions are recorded to the audit log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'contest_manager' } as any);
  });

  it('vote adjustment: propose (202) does NOT append an audit entry — execution (and its audit entry) happens later, at approve time', async () => {
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockReturnValue(chainableInsert({ id: 'approval-1', status: 'pending_approval' }));
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await adjustPOST(
      req('/api/admin/voting/contest-1/adjust', {
        contestantId: 'contestant-1',
        adjustmentType: 'add',
        voteQuantity: 50,
        reason: 'Manual correction after fraud review',
      }),
      { params: Promise.resolve({ contestId: 'contest-1' }) },
    );

    expect(res.status).toBe(202);
    expect(vi.mocked(appendAuditLog)).not.toHaveBeenCalled();
    expect(vi.mocked(getVoteTotals)).not.toHaveBeenCalled();
    expect(vi.mocked(incrementVoteTotals)).not.toHaveBeenCalled();

    // But the initiator identity IS recorded on the proposal itself, so the
    // "attributable" half of the invariant still holds pre-execution.
    const insertedRow = insertFn.mock.calls[0][0] as any;
    expect(insertedRow.initiator_id).toBe('admin-1');
    expect(insertedRow.initiator_role).toBe('contest_manager');
  });

  it('vote reversal: propose (202) does NOT append an audit entry — execution (and its audit entry) happens later, at approve time', async () => {
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockReturnValue(chainableInsert({ id: 'approval-2', status: 'pending_approval' }));
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await reversePOST(
      req('/api/admin/voting/votes/vote-1/reverse', { reason: 'Confirmed fraud via IP cluster' }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );

    expect(res.status).toBe(202);
    expect(vi.mocked(appendAuditLog)).not.toHaveBeenCalled();
    expect(vi.mocked(incrementVoteTotals)).not.toHaveBeenCalled();

    const insertedRow = insertFn.mock.calls[0][0] as any;
    expect(insertedRow.initiator_id).toBe('admin-1');
    expect(insertedRow.payload).toMatchObject({ voteId: 'vote-1', reason: 'Confirmed fraud via IP cluster' });
  });

  it('audit.service exposes no update/delete function — inserts are the only write path (append-only by construction)', async () => {
    const mod = await vi.importActual<typeof import('@/src/server/voting/audit.service')>(
      '@/src/server/voting/audit.service',
    );
    const exportedNames = Object.keys(mod);
    expect(exportedNames).toEqual(expect.arrayContaining(['appendAuditLog', 'getAuditLogs']));
    expect(exportedNames.some((n) => /update|delete|remove/i.test(n))).toBe(false);
  });
});
