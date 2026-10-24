/**
 * /api/admin/academy/area-options — GET / POST / PUT (admin, programs:manage).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));
vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/server/admin/audit', () => ({ addAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET, POST, PUT } from '../../../app/api/admin/academy/area-options/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { createAdminClient } from '@/lib/supabase/server';

type Row = Record<string, unknown>;

const URL_BASE = 'http://localhost/api/admin/academy/area-options';
const AREA_ID = '11111111-1111-4111-8111-111111111111';
const OPT_ID = '22222222-2222-4222-8222-222222222222';

function stored(over: Row = {}): Row {
  return {
    id: OPT_ID,
    area_id: AREA_ID,
    label: 'Weekend',
    duration_label: '3 months',
    price_no_boarding_ngn: 100000,
    price_with_boarding_ngn: 160000,
    is_active: true,
    sort_order: 1,
    updated_at: '2020-01-01T00:00:00.000Z',
    ...over,
  };
}

let tables: Record<string, Row[]>;
let inserts: Array<{ table: string; payload: Row }>;
let updates: Array<{ table: string; payload: Row }>;

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let sortBy: string | null = null;
      let mode: 'select' | 'insert' | 'update' = 'select';
      let payload: Row = {};
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const exec = () => {
        if (mode === 'insert') {
          inserts.push({ table, payload });
          return [{ id: 'new-id', ...payload }];
        }
        if (mode === 'update') {
          updates.push({ table, payload });
          return rows().map((r) => ({ ...r, ...payload }));
        }
        let out = rows();
        if (sortBy) out = [...out].sort((a, b) => Number(a[sortBy!]) - Number(b[sortBy!]));
        return out;
      };
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: Row) => {
          mode = 'insert';
          payload = p;
          return b;
        },
        update: (p: Row) => {
          mode = 'update';
          payload = p;
          return b;
        },
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return b;
        },
        order: (col: string) => {
          sortBy = col;
          return b;
        },
        maybeSingle: async () => ({ data: exec()[0] ?? null, error: null }),
        single: async () => ({ data: exec()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: exec(), error: null }),
      };
      return b;
    },
  };
}

const post = (body: unknown) => POST(makeRequest(URL_BASE, { method: 'POST', body }));
const put = (body: unknown) => PUT(makeRequest(URL_BASE, { method: 'PUT', body }));
const validCreate = (over: Row = {}) => ({
  area_id: AREA_ID,
  label: 'Weekend',
  duration_label: '3 months',
  price_no_boarding_ngn: 100000,
  price_with_boarding_ngn: 160000,
  sort_order: 1,
  is_active: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    academy_interest_areas: [{ id: AREA_ID, slug: 'acting' }],
    academy_area_options: [stored()],
  };
  inserts = [];
  updates = [];
  vi.mocked(assertAdminPermission).mockResolvedValue({ role: 'admin', actorId: 'actor-1' } as never);
  vi.mocked(createAdminClient).mockReturnValue(fakeClient() as never);
});

describe('admin area-options', () => {
  it('403 without programs:manage', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValue(new Error('FORBIDDEN'));
    const res = await post(validCreate());
    expect(res.status).toBe(403);
    expect(vi.mocked(assertAdminPermission).mock.calls[0][1]).toBe('programs:manage');
    expect(inserts).toHaveLength(0);
  });

  it('POST rejects negative or non-integer price', async () => {
    expect((await post(validCreate({ price_no_boarding_ngn: -1 }))).status).toBe(400);
    expect((await post(validCreate({ price_no_boarding_ngn: 1000.5 }))).status).toBe(400);
    expect((await post(validCreate({ price_with_boarding_ngn: 200000.5 }))).status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('POST accepts null price_with_boarding_ngn', async () => {
    const res = await post(validCreate({ price_with_boarding_ngn: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.option.price_with_boarding_ngn).toBeNull();
    expect(inserts[0].payload.price_with_boarding_ngn).toBeNull();
  });

  it('POST rejects with-boarding price below no-boarding price', async () => {
    const res = await post(validCreate({ price_no_boarding_ngn: 100000, price_with_boarding_ngn: 90000 }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('POST rejects an unknown area_id', async () => {
    const res = await post(validCreate({ area_id: '99999999-9999-4999-8999-999999999999' }));
    expect([400, 404]).toContain(res.status);
    expect(inserts).toHaveLength(0);
  });

  it('PUT updates price and sets updated_at', async () => {
    const res = await put({ id: OPT_ID, price_no_boarding_ngn: 120000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.option.price_no_boarding_ngn).toBe(120000);
    expect(updates[0].payload.price_no_boarding_ngn).toBe(120000);
    expect(typeof updates[0].payload.updated_at).toBe('string');
    expect(updates[0].payload.updated_at).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('PUT 404 for unknown id', async () => {
    const res = await put({ id: '99999999-9999-4999-8999-999999999999', label: 'X' });
    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it('PUT partial update validates the >= rule against stored value', async () => {
    // stored with-boarding = 160000; raising no-boarding above it must fail.
    expect((await put({ id: OPT_ID, price_no_boarding_ngn: 170000 })).status).toBe(400);
    // lowering with-boarding below stored no-boarding (100000) must fail.
    expect((await put({ id: OPT_ID, price_with_boarding_ngn: 50000 })).status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it('writes an audit event', async () => {
    await post(validCreate());
    expect(addAuditEvent).toHaveBeenCalledTimes(1);
    await put({ id: OPT_ID, label: 'Renamed' });
    expect(addAuditEvent).toHaveBeenCalledTimes(2);
    const call = vi.mocked(addAuditEvent).mock.calls[1][0];
    expect(call.adminUser).toBe('actor-1');
    expect(call.entityType).toBe('academy_area_options');
    expect(call.entityId).toBe(OPT_ID);
  });

  it('GET requires area_id', async () => {
    const res = await GET(makeRequest(URL_BASE, { method: 'GET' }));
    expect(res.status).toBe(400);
  });

  it('GET returns options for the area', async () => {
    const res = await GET(makeRequest(`${URL_BASE}?area_id=${AREA_ID}`, { method: 'GET' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.options).toHaveLength(1);
  });

  it('403 for GET, POST and PUT, with no DB access before the permission check', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValue(new Error('FORBIDDEN'));
    expect((await GET(makeRequest(`${URL_BASE}?area_id=${AREA_ID}`, { method: 'GET' }))).status).toBe(403);
    expect((await post(validCreate())).status).toBe(403);
    expect((await put({ id: OPT_ID, label: 'X' })).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(addAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects unsafe-integer prices and out-of-range sort_order', async () => {
    expect((await post(validCreate({ price_no_boarding_ngn: 1e300 }))).status).toBe(400);
    expect((await post(validCreate({ price_no_boarding_ngn: 2 ** 53 }))).status).toBe(400);
    expect((await post(validCreate({ price_no_boarding_ngn: 1, price_with_boarding_ngn: 2 ** 53 }))).status).toBe(400);
    expect((await post(validCreate({ sort_order: 2 ** 31 }))).status).toBe(400);
    expect((await post(validCreate({ sort_order: -(2 ** 31) - 1 }))).status).toBe(400);
    expect((await put({ id: OPT_ID, price_no_boarding_ngn: 1e300 })).status).toBe(400);
    expect((await put({ id: OPT_ID, sort_order: 2 ** 31 })).status).toBe(400);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('400 for non-UUID area_id (GET, POST) and id (PUT) before any DB call', async () => {
    expect((await GET(makeRequest(`${URL_BASE}?area_id=not-a-uuid`, { method: 'GET' }))).status).toBe(400);
    expect((await post(validCreate({ area_id: 'not-a-uuid' }))).status).toBe(400);
    expect((await put({ id: 'not-a-uuid', label: 'X' })).status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('trims duration_label and stores empty/whitespace as null', async () => {
    await post(validCreate({ duration_label: '  3 months  ' }));
    expect(inserts[0].payload.duration_label).toBe('3 months');
    await post(validCreate({ duration_label: '   ' }));
    expect(inserts[1].payload.duration_label).toBeNull();
    await put({ id: OPT_ID, duration_label: '  6 months ' });
    expect(updates[0].payload.duration_label).toBe('6 months');
    await put({ id: OPT_ID, duration_label: '' });
    expect(updates[1].payload.duration_label).toBeNull();
  });

  it('PUT cannot change area_id, id or created_at', async () => {
    const res = await put({
      id: OPT_ID,
      area_id: '33333333-3333-4333-8333-333333333333',
      created_at: '1999-01-01T00:00:00.000Z',
      label: 'Renamed',
    });
    expect(res.status).toBe(200);
    expect(Object.keys(updates[0].payload).sort()).toEqual(['label', 'updated_at']);
  });

  it('PUT can set price_with_boarding_ngn to null', async () => {
    const res = await put({ id: OPT_ID, price_with_boarding_ngn: null });
    expect(res.status).toBe(200);
    expect(updates[0].payload.price_with_boarding_ngn).toBeNull();
    expect((await res.json()).option.price_with_boarding_ngn).toBeNull();
  });

  it('audit events carry oldValue and newValue', async () => {
    await post(validCreate());
    const created = vi.mocked(addAuditEvent).mock.calls[0][0];
    expect(created.oldValue ?? null).toBeNull();
    expect(created.newValue).toMatchObject({ label: 'Weekend', price_no_boarding_ngn: 100000 });

    await put({ id: OPT_ID, price_no_boarding_ngn: 120000 });
    const updated = vi.mocked(addAuditEvent).mock.calls[1][0];
    expect(updated.oldValue).toMatchObject({ id: OPT_ID, price_no_boarding_ngn: 100000 });
    expect(updated.newValue).toMatchObject({ id: OPT_ID, price_no_boarding_ngn: 120000 });
  });
});
