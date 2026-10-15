// The public contests list (talent-vault "Live Contests") had two defects:
//   1. its data source (/api/v1/public/contests on the Go backend) does not
//      exist, so the grid was empty for every visitor; and
//   2. it had no notion of active vs closed, so once data did flow, closed
//      contests would sit in the "Live" list.
// This pins the replacement: a server read of connect_contests (the table the
// mobile app's list serves) mapped to active|closed, and a filter whose default
// is Active.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as unknown,
  table: '' as string,
  inFilter: null as [string, string[]] | null,
  order: null as [string, unknown] | null,
  limit: null as number | null,
  cols: '' as string,
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      db.table = t;
      const b: Record<string, unknown> = {};
      b.select = (c: string) => { db.cols = c; return b; };
      b.in = (col: string, vals: string[]) => { db.inFilter = [col, vals]; return b; };
      b.order = (col: string, o: unknown) => { db.order = [col, o]; return b; };
      b.limit = async (n: number) => { db.limit = n; return { data: db.rows, error: db.error }; };
      return b;
    },
  }),
}));

import {
  filterContests,
  getPublicContests,
  type PublicContest,
} from '@/src/server/contests/public-contests';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'id-1', slug: 's-1', title: 'Star Search', description: 'd', status: 'open',
  opens_at: '2026-10-01T00:00:00Z', closes_at: '2026-12-01T00:00:00Z',
  banner_image_url: 'https://cdn.test/b.jpg', logo_url: 'https://cdn.test/l.png', ...over,
});

beforeEach(() => {
  db.rows = [];
  db.error = null;
  db.table = ''; db.inFilter = null; db.order = null; db.limit = null; db.cols = '';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('getPublicContests', () => {
  it('reads connect_contests, open and closed only, newest first, bounded', async () => {
    await getPublicContests();
    expect(db.table).toBe('connect_contests');
    expect(db.inFilter).toEqual(['status', ['open', 'closed']]);
    expect(db.order).toEqual(['created_at', { ascending: false }]);
    expect(db.limit).toBe(60);
    expect(db.cols).toContain('logo_url');
    expect(db.cols).toContain('banner_image_url');
  });

  it('maps open to active and closed to closed, and carries banner + logo', async () => {
    db.rows = [row(), row({ id: 'id-2', status: 'closed', logo_url: '' })];
    const [a, c] = await getPublicContests();
    expect(a).toMatchObject({ id: 'id-1', status: 'active', bannerImageUrl: 'https://cdn.test/b.jpg', logoUrl: 'https://cdn.test/l.png' });
    expect(c).toMatchObject({ id: 'id-2', status: 'closed', logoUrl: '' });
  });

  it('drops any row whose status is neither open nor closed (never trust the filter alone)', async () => {
    db.rows = [row({ status: 'draft' }), row({ id: 'id-3' })];
    const out = await getPublicContests();
    expect(out.map((c) => c.id)).toEqual(['id-3']);
  });

  it('returns an empty list, not a throw, when the read fails (the marketing page must still render)', async () => {
    db.error = { message: 'boom' };
    await expect(getPublicContests()).resolves.toEqual([]);
  });
});

describe('filterContests', () => {
  const mk = (id: string, status: 'active' | 'closed'): PublicContest => ({
    id, slug: id, title: id, description: '', status, opensAt: null, closesAt: null, bannerImageUrl: '', logoUrl: '',
  });
  const list = [mk('a1', 'active'), mk('c1', 'closed'), mk('a2', 'active')];

  it('active returns only active contests', () => {
    expect(filterContests(list, 'active').map((c) => c.id)).toEqual(['a1', 'a2']);
  });
  it('closed returns only closed contests', () => {
    expect(filterContests(list, 'closed').map((c) => c.id)).toEqual(['c1']);
  });
  it('never mutates its input', () => {
    const copy = [...list];
    filterContests(list, 'closed');
    expect(list).toEqual(copy);
  });
});
