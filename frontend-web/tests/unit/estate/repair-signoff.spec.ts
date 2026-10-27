/**
 * PATCH /estate/repairs/[id] — reporter sign-off (EST-UAT-0243/-0244).
 *
 * Only the resident who raised the ticket accepts or rejects the outcome.
 * Rejecting a completed repair reopens it and appends to repair_updates
 * (history preserved); accepting an open ticket completes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
}));
vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { PATCH } from '../../../app/api/v1/estate/repairs/[id]/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

type Row = Record<string, any>;
const ESTATE = 'estate-a';
const REPAIR_ID = '11111111-2222-3333-4444-555555555555';

function fakeSupabase(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; row: Row }> = [];
  const from = (table: string) => {
    const filters: Array<[string, any]> = [];
    const ins: Array<[string, any[]]> = [];
    let patch: Row | null = null;
    let pendingInsert: Row[] | null = null;
    const matches = () =>
      (tables[table] ?? []).filter(
        (r) => filters.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
      );
    const q: any = {
      select: () => q,
      insert: (rows: Row[] | Row) => {
        pendingInsert = Array.isArray(rows) ? rows : [rows];
        return q;
      },
      update: (p: Row) => {
        patch = p;
        return q;
      },
      eq: (c: string, v: any) => (filters.push([c, v]), q),
      in: (c: string, v: any[]) => (ins.push([c, v]), q),
      // `.is(col, null)` matches rows where the column is null or absent.
      is: (c: string, v: any) => (ins.push([c, v === null ? [null, undefined] : [v]]), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      single: async () => {
        if (pendingInsert) {
          tables[table] = [...(tables[table] ?? []), ...pendingInsert];
          writes.push({ table, op: 'insert', row: pendingInsert[0] });
          return { data: pendingInsert[0], error: null };
        }
        const hit = matches()[0];
        if (hit && patch) {
          Object.assign(hit, patch);
          writes.push({ table, op: 'update', row: { ...patch } });
        }
        return { data: hit ?? null, error: null };
      },
      then: (res: any) => {
        if (pendingInsert) {
          tables[table] = [...(tables[table] ?? []), ...pendingInsert];
          writes.push({ table, op: 'insert', row: pendingInsert[0] });
          pendingInsert = null;
          return res({ data: null, error: null });
        }
        return res({ data: matches(), error: null });
      },
    };
    return q;
  };
  return { client: { from }, writes };
}

function seed(repairStatus: string, reporter = 'caller') {
  const tables: Record<string, Row[]> = {
    estate_residents: [{ user_id: 'caller', estate_id: ESTATE, unit: '1', role: 'resident' }],
    estates: [{ id: ESTATE, status: 'active' }],
    estate_repair_requests: [
      { id: REPAIR_ID, estate_id: ESTATE, reporter_id: reporter, category: 'plumbing', description: 'leak', urgency: 'medium', status: repairStatus, created_at: 't0' },
    ],
    repair_updates: [],
    user_profiles: [],
  };
  const fake = fakeSupabase(tables);
  vi.mocked(createAdminClient).mockReturnValue(fake.client as any);
  return { ...fake, tables };
}

const call = (body: any, id = REPAIR_ID) =>
  PATCH(
    new Request('http://x/repair', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('PATCH /estate/repairs/[id] sign-off', () => {
  beforeEach(() => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'caller', email: 'c@e.com' } as any);
  });

  it('lets the reporter reject a completed repair and reopens it', async () => {
    const { writes, tables } = seed('completed');
    const res = await call({ action: 'reject', note: 'still leaking' });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('reopened');
    expect(tables.estate_repair_requests[0].status).toBe('reopened');
    expect(writes).toEqual([
      { table: 'repair_updates', op: 'insert', row: expect.objectContaining({ status: 'reopened', by_user: 'caller' }) },
      { table: 'estate_repair_requests', op: 'update', row: { status: 'reopened' } },
    ]);
  });

  it('lets the reporter accept an in-progress repair', async () => {
    const { tables } = seed('in_progress');
    const res = await call({ action: 'accept' });
    expect(res.status).toBe(200);
    expect(tables.estate_repair_requests[0].status).toBe('completed');
  });

  it('refuses to reject a repair that is not completed (409)', async () => {
    const { writes } = seed('in_progress');
    const res = await call({ action: 'reject' });
    expect(res.status).toBe(409);
    expect(writes).toHaveLength(0);
  });

  it('refuses a non-reporter resident with 403', async () => {
    const { writes } = seed('completed', 'someone-else');
    const res = await call({ action: 'reject' });
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('rejects an invalid action with 400', async () => {
    const res = await call({ action: 'maybe' });
    expect(res.status).toBe(400);
  });
});
