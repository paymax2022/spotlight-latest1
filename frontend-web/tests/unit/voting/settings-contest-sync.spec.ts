import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The admin's paid-voting toggle wrote only to `voting_settings`, which the
 * mobile app never reads — it gates on `connect_contests.paid_vote_kobo`, a
 * mirror of `contests.vote_price_ngn`. The console therefore reported paid
 * voting as ON while every phone reported it unavailable.
 *
 * These lock the bridge: saving settings must also write the contest row.
 */

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

// Static import, placed after the vi.mock calls (vitest hoists the mocks, so the
// route still sees the stubs) — the same shape as
// tests/unit/voting/contest-prizes-admin-api.test.ts. This file used to
// `await import()` the route inside every `it()`, which charged the route
// graph's cold load to the FIRST test's default 5000 ms budget. Measured with a
// throwaway probe: `src/lib/api/responses` 5032 ms (it imports
// `@sentry/nextjs` for one captureException call), `src/server/admin/auth`
// 1439 ms — 6.5 s of module work, then 0 ms for every later import because
// Vite caches the transform. That is the whole reason this file was red on main
// while every sibling that imports a route at the top is green: the cost is the
// same, it just is not inside a timed test any more.
import { POST } from '@/app/api/admin/voting/settings/route';

const CONTEST = 'ed8103b7-418f-467e-a0ed-717ce167f615';

function save(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/voting/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contestId: CONTEST, ...body }),
  });
}

describe('voting settings -> contest sync', () => {
  beforeEach(() => {
    contestUpdate.mockReset().mockResolvedValue({ error: null });
    settingsUpsert.mockReset();
  });

  it('writes the per-vote price to the field the mobile app reads', async () => {
    const res = await POST(save({ paidVotingEnabled: true, pricePerVoteNgn: 150, votingEnabled: true }));

    expect(res.status).toBe(200);
    expect(contestUpdate).toHaveBeenCalledTimes(1);
    const [values, id] = contestUpdate.mock.calls[0];
    expect(id).toBe(CONTEST);
    // naira, not kobo: the DB trigger multiplies by 100 into paid_vote_kobo.
    expect(values).toMatchObject({ vote_price_ngn: 150, vote_price: 150, voting_enabled: true });
  });

  it('zeroes the price when paid voting is turned off, so the two cannot disagree', async () => {
    await POST(save({ paidVotingEnabled: false, pricePerVoteNgn: 150 }));

    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ vote_price_ngn: 0, vote_price: 0 });
  });

  it('ignores a price that is not a positive number rather than writing NaN', async () => {
    await POST(save({ paidVotingEnabled: true, pricePerVoteNgn: '' }));

    expect(contestUpdate.mock.calls[0][0]).toMatchObject({ vote_price_ngn: 0 });
  });

  it('reports a failed contest update instead of claiming the save succeeded', async () => {
    contestUpdate.mockResolvedValue({ error: { message: 'permission denied' } });
    const res = await POST(save({ paidVotingEnabled: true, pricePerVoteNgn: 150 }));

    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('the contest could not be updated');
    // PostgREST internals are logged server-side, never echoed to the admin.
    expect(body).not.toContain('permission denied');
  });

  it('still accepts a blank voting window (the empty-string timestamp trap)', async () => {
    const res = await POST(save({ votingStartsAt: '', votingEndsAt: '', leaderboardFreezeAt: '' }));

    expect(res.status).toBe(200);
    const [values] = settingsUpsert.mock.calls[0];
    expect(values).toMatchObject({ voting_starts_at: null, voting_ends_at: null, leaderboard_freeze_at: null });
  });
});
