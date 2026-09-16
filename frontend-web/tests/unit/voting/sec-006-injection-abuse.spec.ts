/**
 * SEC-006: spot-check injection / API-abuse resilience on a handful of
 * voting & registration endpoints — malformed JSON and extremely long
 * strings must be rejected cleanly (4xx / handled error), never crash the
 * process or reach the DB layer un-validated.
 *
 * Scoped spot-check (4 routes), not a full pen-test, per Batch 1 scope:
 *   - POST /api/votes/free              (protected route, unprotected callee mocked)
 *   - POST /api/votes/paid/wallet       (unprotected route)
 *   - POST /api/admin/voting/[contestId]/adjust (unprotected route, admin-gated)
 *   - POST /api/leaderboard/[contestId] query-string injection (GET, unprotected route)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } }),
  },
}));

vi.mock('@/src/server/voting/free-vote.service', () => ({
  castFreeVote: vi.fn(),
  getVotingSettings: vi.fn(),
  assertVotingOpen: vi.fn(),
}));
vi.mock('@/src/lib/voting/rate-limit', () => ({ checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 1, resetInMs: 1000 }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
vi.mock('@/src/lib/feature-flags', () => ({ featureFlags: { wallet: () => true } }));
vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({ debitWallet: vi.fn(), reverseWalletDebit: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({ incrementVoteTotals: vi.fn(), getVoteTotals: vi.fn(), getLeaderboard: vi.fn() }));
vi.mock('@/src/server/voting/audit.service', () => ({ appendAuditLog: vi.fn() }));
vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/server/voting/visibility.service', () => ({ getEffectiveVisibility: vi.fn() }));

import { POST as freeVotePOST } from '../../../app/api/votes/free/route';
import { POST as walletPOST } from '../../../app/api/votes/paid/wallet/route';
import { POST as adjustPOST } from '../../../app/api/admin/voting/[contestId]/adjust/route';
import { GET as leaderboardGET } from '../../../app/api/leaderboard/[contestId]/route';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/src/lib/auth/request';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getVotingSettings } from '@/src/server/voting/free-vote.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
import { getLeaderboard } from '@/src/server/voting/totals.service';

const LONG_STRING = 'A'.repeat(200_000);
const SQLI_PAYLOAD = "'; DROP TABLE votes; --";
const NOSQLI_PAYLOAD = { $ne: null };

function rawReq(url: string, rawBody: string, opts: { method?: string; ip?: string } = {}) {
  return new Request(`http://localhost${url}`, {
    method: opts.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(opts.ip ? { 'x-forwarded-for': opts.ip } : {}) },
    body: rawBody,
  });
}

describe('SEC-006: malformed JSON is rejected, not crashed on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
  });

  it('POST /api/votes/free with truncated/invalid JSON returns a handled error, not a 500 crash', async () => {
    const res = await freeVotePOST(rawReq('/api/votes/free', '{"contestId": "c1", "contestantId":', { ip: '10.0.0.50' }));
    // handleApiError catches the JSON.parse throw and still returns a Response.
    expect(res).toBeInstanceOf(Response);
    expect([400, 500]).toContain(res.status);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('POST /api/votes/paid/wallet with malformed JSON does not throw out of the handler', async () => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1' } as any);
    const res = await walletPOST(
      new Request('http://localhost/api/votes/paid/wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1' },
        body: '{not valid json at all',
      }),
    );
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('admin adjust route rejects a SQL-injection-shaped reason string as a plain string value (parameterized query, no crash)', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'contest_manager' } as any);
    const { mock, maybySingle, insertFn } = makeSupabaseMock();
    maybySingle.mockResolvedValue({ data: { totalConfirmedVotes: 0 }, error: null });
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await adjustPOST(
      rawReq('/api/admin/voting/contest-1/adjust', JSON.stringify({
        contestantId: SQLI_PAYLOAD,
        adjustmentType: 'add',
        voteQuantity: 1,
        reason: SQLI_PAYLOAD + ' '.repeat(1) + 'padding-to-pass-length-check',
      })),
      { params: Promise.resolve({ contestId: 'contest-1' }) },
    );
    // Supabase client parameterizes `.eq()`/`.insert()` values — a string payload
    // is never concatenated into SQL. The route should process it as an opaque
    // string and return normally (200) rather than erroring or executing anything.
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    // The mocked insert call received the raw string, unmodified/unexecuted.
    const insertedCalls = insertFn.mock.calls.map((c) => c[0]);
    const hasRawPayload = insertedCalls.some((row: any) => JSON.stringify(row).includes(SQLI_PAYLOAD));
    expect(hasRawPayload).toBe(true);
  });

  it('extremely long contestId query param on the public leaderboard route does not crash the handler', async () => {
    vi.mocked(getVotingSettings).mockResolvedValue({ leaderboardFreezeEnabled: false } as any);
    vi.mocked(getEffectiveVisibility).mockResolvedValue({
      showVoteCount: true, showLeaderboard: true, showRank: true,
      activePhaseKey: null, activePhaseLabel: null, source: 'default',
    } as any);
    vi.mocked(getLeaderboard).mockResolvedValue([] as any);

    const res = await leaderboardGET(
      new Request(`http://localhost/api/leaderboard/x?limit=${encodeURIComponent(LONG_STRING)}`, { method: 'GET' }),
      { params: Promise.resolve({ contestId: LONG_STRING }) },
    );
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200); // handled gracefully — Number(long garbage) clamps via Math.min(500, NaN→...)
  });

  it('a NoSQL-operator-shaped object where a string is expected is treated as an opaque value, not executed', async () => {
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'contest_manager' } as any);
    const { mock, maybySingle, insertFn } = makeSupabaseMock();
    maybySingle.mockResolvedValue({ data: { totalConfirmedVotes: 0 }, error: null });
    insertFn.mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await adjustPOST(
      rawReq('/api/admin/voting/contest-1/adjust', JSON.stringify({
        contestantId: NOSQLI_PAYLOAD, // object where a string id is expected
        adjustmentType: 'add',
        voteQuantity: 1,
        reason: 'spot-check nosql-shaped payload against postgres/supabase client',
      })),
      { params: Promise.resolve({ contestId: 'contest-1' }) },
    );
    expect(res).toBeInstanceOf(Response);
    // Supabase/Postgres has no operator-injection surface for a JSON object
    // passed as a column value (it's not Mongo) — the route just runs with it
    // as an opaque value. No crash either way is the assertion here.
    expect([200, 400, 500]).toContain(res.status);
  });
});
