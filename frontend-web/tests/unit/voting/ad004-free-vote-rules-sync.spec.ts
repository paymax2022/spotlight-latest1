/**
 * AD-004 (TS-14 admin portal batch 2) — free-vote rules half of the settings
 * editor. `vote-packages-crud.spec.ts` and `settings-contest-sync.spec.ts`
 * already cover the paid-package CRUD and the paid-price -> contest sync;
 * neither exercises the FREE-vote-rules bridge documented in
 * `app/api/admin/voting/settings/route.ts`'s `syncContestVotingState`:
 *
 *   "Free allowance has to be written to contests.max_votes_per_user, because
 *   the connect mirror derives connect_contests.free_votes_per_user from THAT
 *   column ... Writing the allowance only to voting_settings meant every save
 *   re-fired the mirror, which read an untouched max_votes_per_user and reset
 *   the allowance to 0 ... Verified: a contest on 1 free vote dropped to 0."
 *
 * That fix shipped with a code comment claiming manual verification but no
 * regression test — so a future edit to this function could silently
 * reintroduce the exact bug it describes. This pins it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contestUpdate = vi.fn();
const settingsUpsert = vi.fn();

vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn(async () => ({ role: 'super_admin', actorId: 'test-admin' })),
}));

vi.mock('@/src/server/voting/audit.service', () => ({
  appendAuditLog: vi.fn(async () => undefined),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'contests') {
        return { update: (values: unknown) => ({ eq: (_c: string, id: string) => contestUpdate(values, id) }) };
      }
      return {
        upsert: (values: unknown, opts: unknown) => {
          settingsUpsert(values, opts);
          return { select: () => ({ single: async () => ({ data: { id: 'settings-1' }, error: null }) }) };
        },
      };
    },
  }),
}));

const CONTEST = '7c9b6b2e-2f39-4a4f-9a7a-2c9b3b6f1a11';

function save(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/voting/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contestId: CONTEST, ...body }),
  });
}

describe('AD-004: free-vote-per-day rule syncs to contests.max_votes_per_user', () => {
  beforeEach(() => {
    contestUpdate.mockReset().mockResolvedValue({ error: null });
    settingsUpsert.mockReset();
  });

  it('writes the daily free-vote allowance to the column the mobile mirror reads', async () => {
    const { POST } = await import('@/app/api/admin/voting/settings/route');
    const res = await POST(save({ freeVotingEnabled: true, freeVotesPerDay: 3, votingEnabled: true }));

    expect(res.status).toBe(200);
    expect(contestUpdate).toHaveBeenCalledTimes(1);
    const [values, id] = contestUpdate.mock.calls[0];
    expect(id).toBe(CONTEST);
    expect(values).toMatchObject({ max_votes_per_user: 3 });
  });

  it('regression: does NOT reset the allowance to 0 when other fields (e.g. paid price) are what changed', async () => {
    // This is the exact scenario from the bug report: admin only touches the
    // paid-voting price, but the save must still carry the CURRENT free
    // allowance through, not silently zero it because it wasn't "the field
    // being edited" in the admin's mental model.
    const { POST } = await import('@/app/api/admin/voting/settings/route');
    await POST(save({ paidVotingEnabled: true, pricePerVoteNgn: 150, freeVotingEnabled: true, freeVotesPerDay: 1 }));

    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ max_votes_per_user: 1, vote_price_ngn: 150 });
  });

  it('zeroes the allowance when free voting is turned off', async () => {
    const { POST } = await import('@/app/api/admin/voting/settings/route');
    await POST(save({ freeVotingEnabled: false, freeVotesPerDay: 3 }));

    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ max_votes_per_user: 0 });
  });

  it('treats a non-positive or non-numeric freeVotesPerDay as 0 rather than writing NaN/negative', async () => {
    const { POST } = await import('@/app/api/admin/voting/settings/route');

    await POST(save({ freeVotingEnabled: true, freeVotesPerDay: 0 }));
    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ max_votes_per_user: 0 });

    contestUpdate.mockClear();
    await POST(save({ freeVotingEnabled: true, freeVotesPerDay: -5 }));
    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ max_votes_per_user: 0 });

    contestUpdate.mockClear();
    await POST(save({ freeVotingEnabled: true, freeVotesPerDay: 'not-a-number' }));
    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ max_votes_per_user: 0 });
  });

  it('truncates a fractional freeVotesPerDay to an integer allowance', async () => {
    const { POST } = await import('@/app/api/admin/voting/settings/route');
    await POST(save({ freeVotingEnabled: true, freeVotesPerDay: 4.9 }));
    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ max_votes_per_user: 4 });
  });

  it('defaults freeVotingEnabled to true when omitted, matching the settings-row default', async () => {
    const { POST } = await import('@/app/api/admin/voting/settings/route');
    await POST(save({ freeVotesPerDay: 2 }));
    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ max_votes_per_user: 2 });
  });
});
