/**
 * POST/GET /api/academy/apply — area options pricing (money path).
 *
 * Uses a table-aware fake so each query resolves from its own table's rows,
 * independent of call order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('@/src/server/payments/academy-fee-intents', () => ({
  getAcademyFeeIntentByReference: vi.fn().mockResolvedValue(null),
  consumeAcademyFeeIntent: vi.fn().mockResolvedValue(true),
  releaseAcademyFeeIntent: vi.fn().mockResolvedValue(undefined),
}));

import { POST, GET } from '../../../app/api/academy/apply/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackTransaction } from '@/src/lib/payments';

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

function setup(tables: { areas?: Row[]; options?: Row[]; settings?: Row; optionsTableMissing?: boolean | '42P01' | 'PGRST205' }) {
  const inserts: Array<{ table: string; payload: Row }> = [];
  const data: Record<string, Row[]> = {
    academy_interest_areas: tables.areas ?? [AREA_ACTING],
    academy_area_options: tables.options ?? [],
    academy_batches: [{ id: 'batch-001', max_students: null }],
    academy_batch_interest_areas: [],
    academy_applications: [],
    academy_settings: [
      tables.settings ?? { registration_type: 'free', application_fee: 0, application_fee_refundable: false, tuition_fee: 0 },
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
      Promise.resolve(
        table === 'academy_area_options' && tables.optionsTableMissing
          ? tables.optionsTableMissing === '42P01'
            ? { data: null, error: { code: '42P01', message: 'relation "academy_area_options" does not exist' } }
            : { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.academy_area_options' in the schema cache" } }
          : { data: rows(), error: null },
      ).then(resolve, reject);
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

const FLAG = 'FEATURE_FILM_ACADEMY_AREA_OPTIONS_ENABLED';

afterEach(() => {
  delete process.env[FLAG];
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env[FLAG] = 'true';
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
    // The fake applies the route's is_active filter and sort_order ordering.
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
    const sel = { selections: [{ area: 'acting', option_id: 'opt-acting-1', boarding: false }] };
    expect((await post(body(sel))).status).toBe(201);

    // Admin edits the price AFTER the first application was stored.
    // (with-boarding raised too: an inverted pair is now refused as unavailable).
    data.academy_area_options[0].price_no_boarding_ngn = 999999;
    data.academy_area_options[0].price_with_boarding_ngn = 1999999;
    expect((await post(body(sel))).status).toBe(201);

    const apps = inserts.filter((i) => i.table === 'academy_applications').map((i) => i.payload);
    expect(apps).toHaveLength(2);
    expect(apps[0].tuition_total_ngn).toBe(100000);
    expect((apps[0].selected_options as Row[])[0].price_ngn).toBe(100000);
    expect(apps[1].tuition_total_ngn).toBe(999999);
    expect((apps[1].selected_options as Row[])[0].price_ngn).toBe(999999);
  });
});

describe('POST /api/academy/apply — hardening', () => {
  it.each(['PGRST205', '42P01'] as const)(
    'legacy POST proceeds when the options table is missing (%s)',
    async (code) => {
      const { inserts } = setup({ areas: [AREA_PLAIN], optionsTableMissing: code });
      const res = await post(body({ areas_of_interest: ['plain'] }));
      expect(res.status).toBe(201);
      expect(inserts[0].payload.tuition_total_ngn).toBe(12000);
    },
  );

  it.each(['PGRST205', '42P01'] as const)(
    'selections POST still fails closed when the options table is missing (%s)',
    async (code) => {
      const { inserts } = setup({ optionsTableMissing: code });
      const res = await post(
        body({ selections: [{ area: 'acting', option_id: 'opt-acting-1', boarding: false }] }),
      );
      expect(res.status).toBe(500);
      expect(inserts).toHaveLength(0);
    },
  );

  it('GET returns options: [] and logs the error when the options table is missing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setup({ areas: [AREA_ACTING], optionsTableMissing: 'PGRST205' });
    const res = await GET(makeRequest('/api/academy/apply', { method: 'GET' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.interestAreas[0].options).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('academy_area_options'),
      expect.objectContaining({ code: 'PGRST205' }),
    );
    errSpy.mockRestore();
  });

  it('POST 400 for an option belonging to another area', async () => {
    const { inserts } = setup({
      areas: [AREA_ACTING, AREA_DIRECT],
      options: [option({ id: 'opt-dir-1', area_id: 'area-direct' })],
    });
    const res = await post(
      body({ selections: [{ area: 'acting', option_id: 'opt-dir-1', boarding: false }] }),
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('POST 400 for boarding on an option without a boarding price', async () => {
    const { inserts } = setup({ options: [option({ price_with_boarding_ngn: null })] });
    const res = await post(
      body({ selections: [{ area: 'acting', option_id: 'opt-acting-1', boarding: true }] }),
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('POST 400 for a duplicate area in selections', async () => {
    const { inserts } = setup({ options: [option(), option({ id: 'opt-acting-2' })] });
    const res = await post(
      body({
        selections: [
          { area: 'acting', option_id: 'opt-acting-1', boarding: false },
          { area: 'acting', option_id: 'opt-acting-2', boarding: false },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('paid registration: required fee equals application_fee and tuition is not added', async () => {
    const settings = {
      registration_type: 'paid',
      application_fee: 5000,
      application_fee_refundable: false,
      tuition_fee: 0,
    };
    const verify = vi.mocked(verifyPaystackTransaction);
    const sel = {
      selections: [{ area: 'acting', option_id: 'opt-acting-1', boarding: false }],
      application_fee_reference: 'ref-1',
    };

    // Paying exactly the application fee (not fee + tuition) is accepted.
    const first = setup({ options: [option()], settings });
    verify.mockResolvedValue({
      status: 'success', currency: 'NGN', amountKobo: 500000, customerEmail: 'student@example.com',
    } as never);
    const ok = await post(body(sel));
    expect(ok.status).toBe(201);
    const app = first.inserts.find((i) => i.table === 'academy_applications')!.payload;
    expect(app.application_fee_paid).toBe(5000);
    expect(app.tuition_total_ngn).toBe(100000);

    // Paying less than the application fee is rejected.
    const second = setup({ options: [option()], settings });
    verify.mockResolvedValue({
      status: 'success', currency: 'NGN', amountKobo: 499900, customerEmail: 'student@example.com',
    } as never);
    const low = await post(body(sel));
    expect(low.status).toBe(400);
    expect(second.inserts).toHaveLength(0);
  });
});

describe('/api/academy/apply — feature flag', () => {
  it('GET reports areaOptionsEnabled: true when the flag is on', async () => {
    setup({ areas: [AREA_ACTING], options: [option()] });
    const json = await (await GET(makeRequest('/api/academy/apply', { method: 'GET' }))).json();
    expect(json.areaOptionsEnabled).toBe(true);
    expect(json.interestAreas[0].options).toHaveLength(1);
  });

  it.each([['false'], [undefined]])('GET with flag %s returns options: [] for every area and areaOptionsEnabled: false', async (value) => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    setup({ areas: [AREA_ACTING, AREA_PLAIN], options: [option()] });
    const json = await (await GET(makeRequest('/api/academy/apply', { method: 'GET' }))).json();
    expect(json.areaOptionsEnabled).toBe(false);
    expect(json.interestAreas).toHaveLength(2);
    for (const a of json.interestAreas) expect(a.options).toEqual([]);
    // Legacy fee display data is still there.
    expect(json.interestAreas.find((a: Row) => a.slug === 'acting').fee_ngn).toBe(50000);
  });

  it('POST with selections is rejected 400 when the flag is off', async () => {
    process.env[FLAG] = 'false';
    const { inserts } = setup({ options: [option()] });
    const res = await post(
      body({ selections: [{ area: 'acting', option_id: 'opt-acting-1', boarding: false }] }),
    );
    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toMatch(/not available/i);
    expect(inserts).toHaveLength(0);
  });

  it('legacy POST for an area that HAS options is accepted when the flag is off (fee_ngn tuition)', async () => {
    process.env[FLAG] = 'false';
    const { inserts } = setup({ options: [option()] });
    const res = await post(body({ areas_of_interest: ['acting'] }));
    expect(res.status).toBe(201);
    const app = inserts.find((i) => i.table === 'academy_applications')!.payload;
    expect(app.tuition_total_ngn).toBe(50000);
    expect(app).not.toHaveProperty('selected_options');
  });

  it('legacy POST does not query the options table when the flag is off', async () => {
    process.env[FLAG] = 'false';
    setup({ areas: [AREA_PLAIN], optionsTableMissing: '42P01' });
    // Even an unexpected options-table error is irrelevant: the table is not read.
    const res = await post(body({ areas_of_interest: ['plain'] }));
    expect(res.status).toBe(201);
  });
});
