/**
 * UAT Batch 8 (SEC-005/G-MC) — Contest maker-checker approval flow.
 *
 * End-to-end (route-level, DB mocked) coverage of the propose → approve /
 * reject lifecycle introduced for the three Contest sensitive actions
 * (vote_reversal, vote_adjustment, results_publish), all going through the
 * single contest_admin_approvals table.
 *
 * Uses an in-memory fake for the contest_admin_approvals table (rather than
 * the generic chainable mock) so state transitions can be asserted directly:
 * propose creates a pending row, approve/reject mutate it, and — critically —
 * a failed execution during approve must leave the row untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/server/voting/sensitive-actions.service', () => ({
  executeVoteReversal: vi.fn(),
  executeVoteAdjustment: vi.fn(),
  executeResultsPublish: vi.fn(),
}));

import { POST as reversePOST } from '@/app/api/admin/voting/votes/[voteId]/reverse/route';
import { POST as approvePOST } from '@/app/api/admin/voting/approvals/[approvalId]/approve/route';
import { POST as rejectPOST } from '@/app/api/admin/voting/approvals/[approvalId]/reject/route';
import { GET as listGET } from '@/app/api/admin/voting/approvals/route';
import { createAdminClient } from '@/lib/supabase/server';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { executeVoteReversal } from '@/src/server/voting/sensitive-actions.service';
import { ApiError } from '@/src/lib/api/responses';

// ---------------------------------------------------------------------------
// In-memory fake for contest_admin_approvals
// ---------------------------------------------------------------------------

function makeApprovalsClient() {
  const rows = new Map<string, Record<string, unknown>>();
  let counter = 0;

  function chain() {
    let idFilter: string | undefined;
    let idemFilter: string | undefined;

    const api: any = {
      select: () => api,
      eq: (col: string, val: string) => {
        if (col === 'id') idFilter = val;
        if (col === 'idempotency_key') idemFilter = val;
        return api;
      },
      order: () => api,
      range: () => Promise.resolve({ data: [...rows.values()], error: null }),
      maybeSingle: () => {
        if (idFilter) return Promise.resolve({ data: rows.get(idFilter) ?? null, error: null });
        if (idemFilter) {
          const found = [...rows.values()].find((r) => r.idempotency_key === idemFilter);
          return Promise.resolve({ data: found ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert: (row: Record<string, unknown>) => {
        const id = `approval-${++counter}`;
        const full: Record<string, unknown> = { id, created_at: new Date().toISOString(), ...row };
        rows.set(id, full);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id, status: full.status }, error: null }),
          }),
        };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          if (col === 'id') {
            const existing = rows.get(val);
            if (existing) rows.set(val, { ...existing, ...patch });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
    return api;
  }

  const client = {
    from: (table: string) => {
      if (table !== 'contest_admin_approvals') throw new Error(`Unexpected table: ${table}`);
      return chain();
    },
  };

  return { client, rows };
}

function approveCtx(approvalId: string) {
  return { params: Promise.resolve({ approvalId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('propose → pending row', () => {
  it('creates a pending row with the correct payload and initiator identity', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'maker-1', role: 'contest_manager' } as any);
    const { client, rows } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await reversePOST(
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.status).toBe('pending_approval');
    expect(rows.size).toBe(1);
    const row = [...rows.values()][0] as any;
    expect(row.action_type).toBe('vote_reversal');
    expect(row.status).toBe('pending_approval');
    expect(row.initiator_id).toBe('maker-1');
    expect(row.initiator_role).toBe('contest_manager');
    expect(row.payload).toMatchObject({ voteId: 'vote-1', reason: 'Fraud reversal confirmed' });
  });

  it('is idempotent on a repeated Idempotency-Key — returns the existing row instead of inserting a duplicate', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'maker-1', role: 'contest_manager' } as any);
    const { client, rows } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const makeReq = () =>
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'idem-key-1' },
        body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      });

    const first = await reversePOST(makeReq(), { params: Promise.resolve({ voteId: 'vote-1' }) });
    const firstBody = await first.json();
    const second = await reversePOST(makeReq(), { params: Promise.resolve({ voteId: 'vote-1' }) });
    const secondBody = await second.json();

    expect(rows.size).toBe(1); // only one row ever inserted
    expect(secondBody.approvalId).toBe(firstBody.approvalId);
  });
});

describe('approve', () => {
  it('executes the underlying action and updates status/checker fields correctly', async () => {
    vi.mocked(assertAdminPermission)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'contest_manager' } as any) // propose
      .mockResolvedValueOnce({ actorId: 'checker-1', role: 'super_admin' } as any); // approve
    const { client, rows } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const propose = await reversePOST(
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );
    const { approvalId } = await propose.json();

    vi.mocked(executeVoteReversal).mockResolvedValue({
      voteId: 'vote-1', reversedQuantity: 12,
      walletRefund: { refunded: true, amountKobo: 5000, alreadyRefunded: false },
    } as any);

    const res = await approvePOST(
      new Request(`http://localhost/api/admin/voting/approvals/${approvalId}/approve`, { method: 'POST' }),
      approveCtx(approvalId),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('executed');
    expect(body.executionResult.reversedQuantity).toBe(12);
    expect(vi.mocked(executeVoteReversal)).toHaveBeenCalledWith('vote-1', 'Fraud reversal confirmed', { actorId: 'checker-1', role: 'super_admin' });

    const row = rows.get(approvalId) as any;
    expect(row.status).toBe('executed');
    expect(row.checker_id).toBe('checker-1');
    expect(row.checker_role).toBe('super_admin');
    expect(row.executed_at).toBeTruthy();
    expect(row.execution_result).toMatchObject({ reversedQuantity: 12 });
  });

  it('returns 409 when the approval is not pending', async () => {
    vi.mocked(assertAdminPermission)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'contest_manager' } as any)
      .mockResolvedValueOnce({ actorId: 'checker-1', role: 'super_admin' } as any)
      .mockResolvedValueOnce({ actorId: 'checker-2', role: 'super_admin' } as any);
    const { client } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const propose = await reversePOST(
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );
    const { approvalId } = await propose.json();

    vi.mocked(executeVoteReversal).mockResolvedValue({ voteId: 'vote-1', reversedQuantity: 1, walletRefund: { refunded: false, amountKobo: 0, alreadyRefunded: false } } as any);
    await approvePOST(new Request(`http://localhost/x/approve`, { method: 'POST' }), approveCtx(approvalId));

    // Second approve attempt on the now-'executed' row.
    const res = await approvePOST(new Request(`http://localhost/x/approve`, { method: 'POST' }), approveCtx(approvalId));
    expect(res.status).toBe(409);
  });

  it('returns 403 when the checker is the same user as the initiator (self-approval)', async () => {
    vi.mocked(assertAdminPermission)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'contest_manager' } as any)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'super_admin' } as any); // same actor approving
    const { client, rows } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const propose = await reversePOST(
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );
    const { approvalId } = await propose.json();

    const res = await approvePOST(new Request('http://localhost/x/approve', { method: 'POST' }), approveCtx(approvalId));
    expect(res.status).toBe(403);
    expect(vi.mocked(executeVoteReversal)).not.toHaveBeenCalled();
    expect((rows.get(approvalId) as any).status).toBe('pending_approval');
  });

  it('a failed execution leaves the row pending_approval (never marked executed, retry stays possible)', async () => {
    vi.mocked(assertAdminPermission)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'contest_manager' } as any)
      .mockResolvedValueOnce({ actorId: 'checker-1', role: 'super_admin' } as any);
    const { client, rows } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const propose = await reversePOST(
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );
    const { approvalId } = await propose.json();

    vi.mocked(executeVoteReversal).mockRejectedValue(new ApiError('Vote not found', 404));

    const res = await approvePOST(new Request('http://localhost/x/approve', { method: 'POST' }), approveCtx(approvalId));
    expect(res.status).toBe(404);

    const row = rows.get(approvalId) as any;
    expect(row.status).toBe('pending_approval');
    expect(row.checker_id).toBeUndefined();
    expect(row.executed_at).toBeUndefined();
  });
});

describe('reject', () => {
  it('requires a note of at least 5 characters', async () => {
    vi.mocked(assertAdminPermission)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'contest_manager' } as any)
      .mockResolvedValueOnce({ actorId: 'checker-1', role: 'super_admin' } as any);
    const { client } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const propose = await reversePOST(
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );
    const { approvalId } = await propose.json();

    const res = await rejectPOST(
      new Request('http://localhost/x/reject', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'no' }),
      }),
      approveCtx(approvalId),
    );
    expect(res.status).toBe(400);
  });

  it('sets status to rejected with checker fields on a valid rejection', async () => {
    vi.mocked(assertAdminPermission)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'contest_manager' } as any)
      .mockResolvedValueOnce({ actorId: 'checker-1', role: 'super_admin' } as any);
    const { client, rows } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const propose = await reversePOST(
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );
    const { approvalId } = await propose.json();

    const res = await rejectPOST(
      new Request('http://localhost/x/reject', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'Insufficient evidence of fraud' }),
      }),
      approveCtx(approvalId),
    );
    expect(res.status).toBe(200);

    const row = rows.get(approvalId) as any;
    expect(row.status).toBe('rejected');
    expect(row.checker_id).toBe('checker-1');
    expect(row.checker_note).toBe('Insufficient evidence of fraud');
  });

  it('returns 403 when the checker is the same user as the initiator (self-rejection)', async () => {
    vi.mocked(assertAdminPermission)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'contest_manager' } as any)
      .mockResolvedValueOnce({ actorId: 'maker-1', role: 'super_admin' } as any);
    const { client, rows } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const propose = await reversePOST(
      new Request('http://localhost/api/admin/voting/votes/vote-1/reverse', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Fraud reversal confirmed' }),
      }),
      { params: Promise.resolve({ voteId: 'vote-1' }) },
    );
    const { approvalId } = await propose.json();

    const res = await rejectPOST(
      new Request('http://localhost/x/reject', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: 'Self rejection attempt' }),
      }),
      approveCtx(approvalId),
    );
    expect(res.status).toBe(403);
    expect((rows.get(approvalId) as any).status).toBe('pending_approval');
  });
});

describe('list', () => {
  it('returns approvals with a human-readable summary, accessible to a maker-only identity', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValueOnce({ actorId: 'maker-1', role: 'contest_manager' } as any);
    const { client, rows } = makeApprovalsClient();
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    rows.set('approval-x', {
      id: 'approval-x', action_type: 'vote_reversal', contest_id: null,
      payload: { voteId: 'vote-9', reason: 'Fraud' }, status: 'pending_approval',
      initiator_id: 'maker-1', initiator_role: 'contest_manager',
      checker_id: null, checker_role: null, checker_note: null, checked_at: null,
      executed_at: null, execution_result: null, created_at: new Date().toISOString(),
    });

    const res = await listGET(new Request('http://localhost/api/admin/voting/approvals', { method: 'GET' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0].summary).toBe('Reverse vote vote-9: Fraud');
  });
});
