/**
 * POST/GET /api/academy/apply — area options pricing (money path).
 *
 * Uses a table-aware fake so each query resolves from its own table's rows,
 * independent of call order.
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
vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));
vi.mock('@/src/server/user/profile', () => ({
  getOrCreateUserProfile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/payments', () => ({ verifyPaystackTransaction: vi.fn() }));

import { POST, GET } from '../../../app/api/academy/apply/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

type Row = Record<string, unknown>;

const AREA_ACTING = { id: 'area-acting', slug: 'acting', label: 'Acting', description: null, fee_ngn: 50000, is_active: true };
const AREA_DIRECT = { id: 'area-direct', slug: 'directing', label: 'Directing', description: null, fee_ngn: 70000, is_active: true };
const AREA_PLAIN = { id: 'area-plain', slug: 'plain', label: 'Plain', description: null, fee_ngn: 12000, is_active: true };

function option(over: Row = {}): Row {
  return {
    id: 'opt-acting-1',
    area_id: 'area-acting',
    label: 'Weekend',
    duration_label: '3 months',
    price_no_boarding_ngn: 100000,
    price_with_boarding_ngn: 160000,
    is_active: true,
    sort_order: 1,
    ...over,
  };
}

function setup(tables: { areas?: Row[]; options?: Row[] }) {
  const inserts: Array<{ table: string; payload: Row }> = [];
  const data: Record<string, Row[]> = {
    academy_interest_areas: tables.areas ?? [AREA_ACTING],
    academy_area_options: tables.options ?? [],
    academy_batches: [{ id: 'batch-001', max_students: null }],
    academy_batch_interest_areas: [],
    academy_applications: [],
    academy_settings: [
      { registration_type: 'free', application_fee: 0, application_fee_refundable: false, tuition_fee: 0 },
    ],
  };
  const from = (table: string) => {
    let filters: Array<(r: Row) => boolean> = [];
    let sortBy: string | null = null;
    const rows = () => {
      const out = (data[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (sortBy) out.sort((x, y) => Number(x[sortBy!]) - Number(y[sortBy!]));
      return out;
    };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'neq', 'ilike', 'or', 'not', 'is', 'limit']) {
      b[m] = vi.fn(chain);
    }
    b.eq = vi.fn((col: string, val: unknown) => {
      // Only the option/area tables are filtered; other tables return their rows.
      if (table === 'academy_area_options' || table === 'academy_interest_areas') {
        filters.push((r) => r[col] === val);
      }
      return b;
    });
    b.in = vi.fn((col: string, vals: unknown[]) => {
      if (table === 'academy_area_options' || table === 'academy_interest_areas') {
        filters.push((r) => vals.includes(r[col]));
      }
      return b;
    });
    b.order = vi.fn((col: string) => {
      sortBy = col;
      return b;
    });
    b.maybeSingle = vi.fn(async () => ({
      data: table === 'academy_settings' ? rows()[0] : table === 'academy_batches' ? rows()[0] : null,
      error: null,
    }));
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    b.insert = vi.fn(async (payload: Row) => {
      inserts.push({ table, payload });
      return { error: null };
    });
    b.update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    return b;
  };
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { data, inserts };
}

function body(over: Row = {}) {
  return {
    full_name: 'Ada Okafor',
    email: 'student@example.com',
    phone: '08012345678',
    batch_id: 'batch-001',
    motivation: 'I want to act.',
    payment_preference: 'installment',
    ...over,
  };
}

const post = (b: Row) => POST(makeRequest('/api/academy/apply', { body: b }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-001', email: 'student@example.com' } as never);
});

describe('GET /api/academy/apply — options', () => {
  it('GET nests active options under each area', async () => {
    setup({
      areas: [AREA_ACTING, AREA_PLAIN],
      options: [
        option({ id: 'o2', label: 'Second', sort_order: 2 }),
        option({ id: 'o1', label: 'First', sort_order: 1 }),
        option({ id: 'o3', label: 'Retired', is_active: false, sort_order: 3 }),
      ],
    });
    const res = await GET(makeRequest('/api/academy/apply', { method: 'GET' }));
    const json = await res.json();
    const acting = json.interestAreas.find((a: Row) => a.slug === 'acting');
    const plain = json.interestAreas.find((a: Row) => a.slug === 'plain');
    expect(acting.fee_ngn).toBe(50000);
    expect(plain.options).toEqual([]);
    expect(acting.options.length).toBeGreaterThan(0);
    expect(acting.options[0]).toEqual({
      id: expect.any(String),
      label: expect.any(String),
      duration_label: '3 months',
      price_no_boarding_ngn: 100000,
      price_with_boarding_ngn: 160000,
    });
    // The fake does not filter/order in SQL, so assert the route asked for it.
    expect(acting.options.every((o: Row) => o.id !== 'o3')).toBe(true);
    expect(acting.options.map((o: Row) => o.id)).toEqual(['o1', 'o2']);
  });
});

describe('POST /api/academy/apply — selections', () => {
  it('POST prices from DB rows, not client price', async () => {
    const { inserts } = setup({ options: [option()] });
    const res = await post(
      body({
        selections: [
          { area: 'acting', option_id: 'opt-acting-1', boarding: true, price_ngn: 1, price: 1, total_ngn: 1 },
        ],
        tuition_total_ngn: 1,
      }),
    );
    expect(res.status).toBe(201);
    const app = inserts.find((i) => i.table === 'academy_applications')!.payload;
    expect(app.tuition_total_ngn).toBe(160000);
  });

  it('POST stores selected_options snapshot and tuition_total_ngn', async () => {
    const { inserts } = setup({
      areas: [AREA_ACTING, AREA_DIRECT],
      options: [
        option(),
        option({ id: 'opt-dir-1', area_id: 'area-direct', label: 'Intensive', duration_label: null, price_no_boarding_ngn: 200000, price_with_boarding_ngn: null }),
      ],
    });
    const res = await post(
      body({
        selections: [
          { area: 'acting', option_id: 'opt-acting-1', boarding: false },
          { area: 'directing', option_id: 'opt-dir-1', boarding: false },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const app = inserts.find((i) => i.table === 'academy_applications')!.payload;
    expect(app.tuition_total_ngn).toBe(300000);
    expect(app.areas_of_interest).toEqual(['acting', 'directing']);
    expect(app.selected_options).toEqual([
      { area_slug: 'acting', option_id: 'opt-acting-1', label: 'Weekend', duration_label: '3 months', boarding: false, price_ngn: 100000 },
      { area_slug: 'directing', option_id: 'opt-dir-1', label: 'Intensive', duration_label: null, boarding: false, price_ngn: 200000 },
    ]);
  });

  it('POST 400 for area with options when only areas_of_interest sent', async () => {
    const { inserts } = setup({ options: [option()] });
    const res = await post(body({ areas_of_interest: ['acting'] }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(String(json.error)).toMatch(/option/i);
    expect(inserts).toHaveLength(0);
  });

  it('POST legacy payload still works for an area with no options', async () => {
    const { inserts } = setup({ areas: [AREA_PLAIN], options: [] });
    const res = await post(body({ areas_of_interest: ['plain'] }));
    expect(res.status).toBe(201);
    const app = inserts.find((i) => i.table === 'academy_applications')!.payload;
    expect(app.tuition_total_ngn).toBe(12000);
    expect(app).not.toHaveProperty('selected_options');
  });

  it('POST 400 when selected area has no active options', async () => {
    const { inserts } = setup({ options: [option({ is_active: false })] });
    const res = await post(
      body({ selections: [{ area: 'acting', option_id: 'opt-acting-1', boarding: false }] }),
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('POST 400 when selected area has no options at all', async () => {
    const { inserts } = setup({ options: [] });
    const res = await post(
      body({ selections: [{ area: 'acting', option_id: 'nope', boarding: false }] }),
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it.each([
    ['selections not an array', { selections: 'acting' }],
    ['boarding not boolean', { selections: [{ area: 'acting', option_id: 'opt-acting-1', boarding: 'yes' }] }],
    ['boarding missing', { selections: [{ area: 'acting', option_id: 'opt-acting-1' }] }],
    ['option_id empty', { selections: [{ area: 'acting', option_id: '', boarding: false }] }],
    ['area not a string', { selections: [{ area: 5, option_id: 'opt-acting-1', boarding: false }] }],
  ])('POST 400 when %s', async (_n, extra) => {
    const { inserts } = setup({ options: [option()] });
    const res = await post(body(extra as Row));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('snapshot is unchanged after the option price is later edited', async () => {
    const { data, inserts } = setup({ options: [option()] });
    const res = await post(
      body({ selections: [{ area: 'acting', option_id: 'opt-acting-1', boarding: false }] }),
    );
    expect(res.status).toBe(201);

    // Admin edits the price AFTER the application was stored.
    data.academy_area_options[0].price_no_boarding_ngn = 999999;

    const stored = inserts.find((i) => i.table === 'academy_applications')!.payload;
    expect(stored.tuition_total_ngn).toBe(100000);
    expect((stored.selected_options as Row[])[0].price_ngn).toBe(100000);
  });
});
