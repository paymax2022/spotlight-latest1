/**
 * AD-007 (TS-14 admin portal batch 2) — live vote monitoring & tally:
 * freeze/unfreeze and manual adjustment functional correctness.
 *
 * `admin-leaderboard-visibility.spec.ts` (Batch 1) already proves the admin
 * leaderboard READ never applies public-visibility gating (VV-004). This
 * covers the two admin WRITE actions that sit alongside it:
 *   - POST /api/admin/voting/[contestId]/freeze  (freeze/unfreeze a snapshot)
 *   - POST /api/admin/voting/[contestId]/adjust   (manual vote correction)
 *
 * Routes under test are NOT hook-protected (only src/server/voting/*.service.ts
 * and the public votes/* routes are).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({
  getLeaderboard: vi.fn(),
  getVoteTotals: vi.fn(),
  incrementVoteTotals: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { POST as freezePOST } from '../../../app/api/admin/voting/[contestId]/freeze/route';
import { POST as adjustPOST } from '../../../app/api/admin/voting/[contestId]/adjust/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { getLeaderboard, getVoteTotals, incrementVoteTotals } from '@/src/server/voting/totals.service';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';

function req(url: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function ctx() {
  return { params: Promise.resolve({ contestId: 'contest-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'contest_manager' } as any);
});

describe('AD-007: leaderboard freeze/unfreeze', () => {
  it('freeze snapshots the live leaderboard, marks it non-final, and flips the freeze flag on', async () => {
    vi.mocked(getLeaderboard).mockResolvedValue([{ contestantId: 'c-1', totalConfirmedVotes: 42 }] as any);
    const { mock, insertFn, updateFn, updateEq } = makeSupabaseMock();
    insertFn.mockResolvedValue({ error: null });
    updateEq.mockResolvedValue({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await freezePOST(req('/api/admin/voting/contest-1/freeze', { action: 'freeze' }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe('freeze');

    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
      contest_id: 'contest-1',
      is_final: false,
      snapshot_data: [{ contestantId: 'c-1', totalConfirmedVotes: 42 }],
    }));
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ leaderboard_freeze_enabled: true }));
    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'leaderboard_frozen', contestId: 'contest-1' }));
  });

  it('unfreeze clears the freeze flag and timestamp without touching the snapshot table', async () => {
    const { mock, insertFn, updateFn, updateEq } = makeSupabaseMock();
    updateEq.mockResolvedValue({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await freezePOST(req('/api/admin/voting/contest-1/freeze', { action: 'unfreeze' }), ctx());
    expect(res.status).toBe(200);

    expect(insertFn).not.toHaveBeenCalled();
    expect(updateFn).toHaveBeenCalledWith({ leaderboard_freeze_enabled: false, leaderboard_freeze_at: null });
    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'leaderboard_unfrozen' }));
  });

  it('rejects a request with no action', async () => {
    const res = await freezePOST(req('/api/admin/voting/contest-1/freeze', {}), ctx());
    expect(res.status).toBe(400);
  });

  it('requires votes:manage — a denied caller never reaches the DB', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const { mock, insertFn } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await freezePOST(req('/api/admin/voting/contest-1/freeze', { action: 'freeze' }), ctx());
    expect(res.status).toBe(403);
    expect(insertFn).not.toHaveBeenCalled();
  });
});

describe('AD-007: manual vote adjustment correctness', () => {
  it('add: increments totals by exactly voteQuantity and reports the real before/after totals', async () => {
    vi.mocked(getVoteTotals)
      .mockResolvedValueOnce({ totalConfirmedVotes: 100 } as any)
      .mockResolvedValueOnce({ totalConfirmedVotes: 150 } as any);
    vi.mocked(incrementVoteTotals).mockResolvedValue(undefined as any);
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await adjustPOST(
      req('/api/admin/voting/contest-1/adjust', {
        contestantId: 'contestant-1', adjustmentType: 'add', voteQuantity: 50, reason: 'Manual correction',
      }),
      ctx(),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ beforeTotal: 100, afterTotal: 150, adjustment: 50 });
    expect(incrementVoteTotals).toHaveBeenCalledWith('contest-1', 'contestant-1', { adminAdjustmentVotes: 50 });
  });

  it('subtract: applies a reversedVotes delta, not a raw negative add', async () => {
    vi.mocked(getVoteTotals)
      .mockResolvedValueOnce({ totalConfirmedVotes: 100 } as any)
      .mockResolvedValueOnce({ totalConfirmedVotes: 80 } as any);
    vi.mocked(incrementVoteTotals).mockResolvedValue(undefined as any);
    const { mock, insertFn } = makeSupabaseMock();
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await adjustPOST(
      req('/api/admin/voting/contest-1/adjust', {
        contestantId: 'contestant-1', adjustmentType: 'subtract', voteQuantity: 20, reason: 'Fraud reversal',
      }),
      ctx(),
    );
    expect(incrementVoteTotals).toHaveBeenCalledWith('contest-1', 'contestant-1', { reversedVotes: 20 });
  });

  it('rejects a non-positive voteQuantity', async () => {
    const res = await adjustPOST(
      req('/api/admin/voting/contest-1/adjust', { contestantId: 'c-1', adjustmentType: 'add', voteQuantity: 0, reason: 'Because' }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a reason shorter than 5 characters', async () => {
    const res = await adjustPOST(
      req('/api/admin/voting/contest-1/adjust', { contestantId: 'c-1', adjustmentType: 'add', voteQuantity: 5, reason: 'hi' }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unrecognized adjustmentType instead of silently reporting success on a no-op', async () => {
    // Prior behaviour: an unknown adjustmentType fell through both the 'add'
    // and 'subtract'/'reverse' branches, so `delta` stayed `{}`, no vote row
    // was inserted, incrementVoteTotals ran with an empty delta, and the
    // route still returned 200 with beforeTotal === afterTotal — reporting
    // "success" for an adjustment that changed nothing. An admin retrying a
    // typo'd adjustmentType would see a green response and assume it worked.
    vi.mocked(getVoteTotals).mockResolvedValue({ totalConfirmedVotes: 100 } as any);
    const { mock, insertFn } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await adjustPOST(
      req('/api/admin/voting/contest-1/adjust', {
        contestantId: 'c-1', adjustmentType: 'bogus', voteQuantity: 10, reason: 'Testing garbage type',
      }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect(incrementVoteTotals).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('requires votes:manage — a denied caller never touches totals', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await adjustPOST(
      req('/api/admin/voting/contest-1/adjust', { contestantId: 'c-1', adjustmentType: 'add', voteQuantity: 5, reason: 'Because' }),
      ctx(),
    );
    expect(res.status).toBe(403);
    expect(incrementVoteTotals).not.toHaveBeenCalled();
  });
});
