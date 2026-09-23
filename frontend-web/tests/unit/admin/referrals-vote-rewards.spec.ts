/**
 * REF-007 — admin visibility for System C (flat ₦500 vote-triggered referral
 * reward). Exercises app/api/admin/referrals/vote-rewards/route.ts directly,
 * mocking Supabase at the module boundary — mirrors
 * tests/unit/admin/payments-finance-stats.spec.ts's pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET } from '@/app/api/admin/referrals/vote-rewards/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';

function req(qs = ''): Request {
  return new Request(`https://x.test/api/admin/referrals/vote-rewards${qs}`, { method: 'GET' });
}

/**
 * Builds a fake Supabase admin client. `.from('referral_events')` returns a
 * chain that resolves to `pageRows` when `.range()` is awaited (the capped
 * page query) and to `aggRows` when awaited directly without `.range()` (the
 * unbounded aggregate query) — both queries share the same filter methods
 * (.gte/.lte/.eq), recorded for assertion. `.from('user_profiles')` resolves
 * to `profileRows`.
 */
function makeSupabase(opts: {
  pageRows: any[];
  aggRows: any[];
  profileRows?: any[];
  pageError?: { message: string } | null;
  aggError?: { message: string } | null;
}) {
  const filterCalls: { table: string; method: string; args: any[] }[] = [];

  function referralEventsChain(forPage: boolean) {
    const chain: any = {
      select: () => chain,
      gte: (...args: any[]) => { filterCalls.push({ table: 'referral_events', method: 'gte', args }); return chain; },
      lte: (...args: any[]) => { filterCalls.push({ table: 'referral_events', method: 'lte', args }); return chain; },
      eq: (...args: any[]) => { filterCalls.push({ table: 'referral_events', method: 'eq', args }); return chain; },
      order: () => chain,
      range: () => Promise.resolve({ data: opts.pageRows, error: opts.pageError ?? null, count: opts.pageRows.length }),
      then: (resolve: any) =>
        Promise.resolve({ data: opts.aggRows, error: opts.aggError ?? null }).then(resolve),
    };
    return chain;
  }

  const client = {
    from: (table: string) => {
      if (table === 'referral_events') {
        // applyFilters() is called twice (page + agg) on two separate
        // `.from()` calls in the route — return a fresh chain each time.
        return referralEventsChain(true);
      }
      if (table === 'user_profiles') {
        const chain: any = {
          select: () => chain,
          in: () => Promise.resolve({ data: opts.profileRows ?? [], error: null }),
        };
        return chain;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { client, filterCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
});

describe('REF-007: admin/referrals/vote-rewards', () => {
  it('requires finance:view permission', async () => {
    const { client } = makeSupabase({ pageRows: [], aggRows: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    await GET(req());

    expect(assertAdminPermission).toHaveBeenCalledWith(expect.anything(), 'finance:view');
  });

  it('rejects when assertAdminPermission throws (non-admin / no token)', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const { client } = makeSupabase({ pageRows: [], aggRows: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req());

    expect(res.status).toBe(403);
  });

  it('returns events joined with referrer/referred display names', async () => {
    const pageRows = [
      {
        id: 'evt-1', referrer_id: 'ref-1', referred_id: 'red-1',
        idempotency_key: 'referral-reward:ref-1:red-1', amount_kobo: 50000,
        ledger_entry_id: 'ledg-1', rewarded_at: '2026-09-01T10:00:00.000Z',
      },
    ];
    const profileRows = [
      { id: 'ref-1', full_name: 'Ada Referrer', email: 'ada@example.com' },
      { id: 'red-1', full_name: null, email: 'red@example.com' },
    ];
    const { client } = makeSupabase({ pageRows, aggRows: pageRows, profileRows });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      id: 'evt-1',
      referrerId: 'ref-1',
      referrerName: 'Ada Referrer',
      referredId: 'red-1',
      referredName: 'red@example.com',
      amountKobo: 50000,
      ledgerEntryId: 'ledg-1',
    });
  });

  it('computes stats from an unbounded aggregate, not the capped page', async () => {
    // Page is capped to 1 row; the aggregate (no range/limit) reports 3 rows
    // across 2 distinct referrers. If the route regressed to summing only
    // the page, totalRewardsKobo would be 50000 and distinctReferrersRewarded 1.
    const pageRows = [
      { id: 'evt-1', referrer_id: 'ref-1', referred_id: 'red-1', idempotency_key: 'k1', amount_kobo: 50000, ledger_entry_id: null, rewarded_at: '2026-09-03T00:00:00.000Z' },
    ];
    const aggRows = [
      { referrer_id: 'ref-1', amount_kobo: 50000 },
      { referrer_id: 'ref-1', amount_kobo: 50000 },
      { referrer_id: 'ref-2', amount_kobo: 50000 },
    ];
    const { client } = makeSupabase({ pageRows, aggRows, profileRows: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req());
    const body = await res.json();

    expect(body.stats.totalRewardsKobo).toBe(150000);
    expect(body.stats.distinctReferrersRewarded).toBe(2);
    expect(body.stats.eventCount).toBe(3);
  });

  it('applies from/to/referrerId query params as filters', async () => {
    const { client, filterCalls } = makeSupabase({ pageRows: [], aggRows: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    await GET(req('?from=2026-09-01&to=2026-09-10&referrerId=ref-9'));

    const gte = filterCalls.filter((c) => c.method === 'gte');
    const lte = filterCalls.filter((c) => c.method === 'lte');
    const eq = filterCalls.filter((c) => c.method === 'eq');
    expect(gte.length).toBeGreaterThan(0);
    expect(gte[0].args).toEqual(['rewarded_at', '2026-09-01']);
    expect(lte.length).toBeGreaterThan(0);
    expect(lte[0].args).toEqual(['rewarded_at', '2026-09-10']);
    expect(eq.length).toBeGreaterThan(0);
    expect(eq[0].args).toEqual(['referrer_id', 'ref-9']);
  });

  it('returns empty results with no error when there are no reward events', async () => {
    const { client } = makeSupabase({ pageRows: [], aggRows: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.events).toEqual([]);
    expect(body.stats.totalRewardsKobo).toBe(0);
    expect(body.stats.distinctReferrersRewarded).toBe(0);
  });
});
