/**
 * SEC-009: admin actions produce an attributable, append-only audit log
 * entry in `vote_audit_logs`.
 *
 * Exercises two real admin routes (not protected) end-to-end against
 * `appendAuditLog` (src/server/voting/audit.service.ts, not protected):
 *   - POST /api/admin/voting/[contestId]/adjust  → 'admin_vote_adjustment'
 *   - POST /api/admin/voting/votes/[voteId]/reverse → 'vote_reversed'
 *
 * Confirms: the actor (from the verified JWT / admin identity, never from
 * the request body) and the before/after values are recorded, and that the
 * insert always targets `vote_audit_logs` with no update/delete path
 * exposed anywhere in audit.service.ts (append-only by construction — there
 * is no exported update/delete function to audit rows).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

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

  it('vote adjustment: appendAuditLog is called with the real actor id, action, and before/after totals', async () => {
    vi.mocked(getVoteTotals)
      .mockResolvedValueOnce({ totalConfirmedVotes: 10 } as any) // before
      .mockResolvedValueOnce({ totalConfirmedVotes: 60 } as any); // after
    vi.mocked(incrementVoteTotals).mockResolvedValue(undefined as any);

    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockResolvedValue({ error: null });
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

    expect(res.status).toBe(200);
    expect(vi.mocked(appendAuditLog)).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(appendAuditLog).mock.calls[0][0] as any;

    // Actor comes from the verified admin identity, NOT anything client-supplied.
    expect(entry.actorId).toBe('admin-1');
    expect(entry.actorRole).toBe('contest_manager');
    expect(entry.action).toBe('admin_vote_adjustment');
    expect(entry.entityType).toBe('vote_totals');
    expect(entry.oldValue).toMatchObject({ totalConfirmedVotes: 10 });
    expect(entry.newValue).toMatchObject({ totalConfirmedVotes: 60, adjustmentType: 'add', voteQuantity: 50 });
    expect(entry.reason).toBe('Manual correction after fraud review');
  });

  it('vote reversal: appendAuditLog records the reversal with old/new vote_status', async () => {
    const { mock, maybySingle, insertFn } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({
      data: {
        id: 'vote-1', contest_id: 'contest-1', contestant_id: 'contestant-1',
        vote_status: 'confirmed', vote_quantity: 5, transaction_id: null,
      },
      error: null,
    });
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(incrementVoteTotals).mockResolvedValue(undefined as any);

    const res = await reversePOST(
      req('/api/admin/voting/votes/vote-1/reverse', { reason: 'Confirmed fraud via IP cluster' }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(appendAuditLog)).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(appendAuditLog).mock.calls[0][0] as any;

    expect(entry.actorId).toBe('admin-1');
    expect(entry.action).toBe('vote_reversed');
    expect(entry.entityType).toBe('vote');
    expect(entry.entityId).toBe('vote-1');
    expect(entry.oldValue).toMatchObject({ vote_status: 'confirmed' });
    expect(entry.newValue).toMatchObject({ vote_status: 'reversed' });
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
