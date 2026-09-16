/**
 * VV-007 regression: hidden results must never leak in exports/logs/cache.
 *
 * The CSV export route (`type=leaderboard`) and the revenue report route both
 * read vote counts/ranks WITHOUT consulting getEffectiveVisibility — that is
 * correct BY DESIGN (these are admin-only financial/ops artifacts, not public
 * surfaces the public-hide toggle governs), but it means the only thing
 * standing between "hidden vote counts" and "counts in a downloadable file"
 * is the RBAC check (`assertAdminPermission`). This suite pins that the RBAC
 * gate actually runs BEFORE any data is read or returned — i.e. an
 * unauthenticated or under-privileged caller gets zero rows, not a redacted
 * or partial CSV/JSON.
 *
 * The frozen-leaderboard-snapshot redaction path (the other half of VV-007)
 * is already covered by `leaderboard-visibility.spec.ts`.
 *
 * Routes under test (NOT protected — admin routes, not the public voting engine):
 *   frontend-web/app/api/admin/voting/[contestId]/export/route.ts
 *   frontend-web/app/api/admin/voting/[contestId]/revenue/route.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));

import { GET as exportGet } from '../../../app/api/admin/voting/[contestId]/export/route';
import { GET as revenueGet } from '../../../app/api/admin/voting/[contestId]/revenue/route';
import { createAdminClient } from '@/lib/supabase/server';

const ORIGINAL_ADMIN_KEY = process.env.SPOTLIGHT_ADMIN_API_KEY;

function ctx() {
  return { params: Promise.resolve({ contestId: 'contest-1' }) };
}
function request(url: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, { method: 'GET', headers });
}

describe('Voting CSV export & revenue routes — RBAC gate runs before any read (VV-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPOTLIGHT_ADMIN_API_KEY = 'test-admin-key';
    const { mock, listData } = makeSupabaseMock();
    listData.mockResolvedValue({
      data: [{ contestant_id: 'enr-1', rank: 1, total_confirmed_votes: 100, free_votes: 60, paid_votes: 40 }],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
  });
  afterEach(() => {
    process.env.SPOTLIGHT_ADMIN_API_KEY = ORIGINAL_ADMIN_KEY;
  });

  it('export: 401s with no credentials — no CSV body leaked', async () => {
    const res = await exportGet(request('/api/admin/voting/contest-1/export?type=leaderboard'), ctx());
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain('total_confirmed_votes');
    expect(body).not.toContain('100');
  });

  it('export: 403s a caller without reports:export permission', async () => {
    const res = await exportGet(
      request('/api/admin/voting/contest-1/export?type=leaderboard', {
        'x-admin-key': 'test-admin-key',
        'x-admin-role': 'judge', // judge has no reports:export permission
      }),
      ctx(),
    );
    expect(res.status).toBe(403);
  });

  it('export: an authorized admin (auditor, has reports:export) CAN export the leaderboard CSV', async () => {
    const res = await exportGet(
      request('/api/admin/voting/contest-1/export?type=leaderboard', {
        'x-admin-key': 'test-admin-key',
        'x-admin-role': 'auditor',
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('revenue: 401s with no credentials — no revenue figures leaked', async () => {
    const res = await revenueGet(request('/api/admin/voting/contest-1/revenue'), ctx());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.totalRevenue).toBeUndefined();
  });

  it('revenue: 403s a caller without finance:view permission', async () => {
    const res = await revenueGet(
      request('/api/admin/voting/contest-1/revenue', {
        'x-admin-key': 'test-admin-key',
        'x-admin-role': 'content_manager', // no finance:view
      }),
      ctx(),
    );
    expect(res.status).toBe(403);
  });

  it('revenue: an authorized finance_admin can read revenue figures', async () => {
    // The revenue route awaits chains that terminate on `.eq(...)` directly
    // (no maybeSingle/range) — build a minimal thenable builder where every
    // chain method (including a second/third `.eq()`) stays chainable AND
    // resolves to an empty result when finally awaited.
    function builder(): any {
      const b: any = { then: (res: any) => Promise.resolve({ data: [], error: null }).then(res) };
      for (const m of ['select', 'eq']) b[m] = () => b;
      return b;
    }
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => builder()),
    } as any);

    const res = await revenueGet(
      request('/api/admin/voting/contest-1/revenue', {
        'x-admin-key': 'test-admin-key',
        'x-admin-role': 'finance_admin',
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalRevenue).toBe(0);
  });
});
