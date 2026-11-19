/**
 * /api/academy/apply — composite format pricing.
 *
 * GET publishes each active area's five formats (per-area prices) plus the
 * format structure; POST prices tuition on the SERVER from the stored
 * academy_area_pricing_options rows — per-area via `area_selections`, or one
 * format for every area via the legacy `pricing_option_key` / no key at all.
 * Tuition is recorded (frozen) on the application and never charged at submit;
 * only academy_settings.application_fee is.
 *
 * The shared golden-path Supabase mock serves one row set to every table, so
 * this spec keeps a small in-memory fake that answers per table and actually
 * applies eq/in/ilike filters.
 *
 * Protected source: frontend-web/app/api/academy/apply/route.ts (DO NOT EDIT)
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

import { GET, POST } from '../../../app/api/academy/apply/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackTransaction } from '@/src/lib/payments';
import type { AcademyPricingFormat } from '@/src/server/services/academy/pricing';

// The catalogue as DATA, seeded into the fake academy_pricing_formats table.
// This used to be an import of the hardcoded structure, which meant the spec
// proved the endpoint agreed with a constant; now it proves the endpoint agrees
// with the rows, which is what the operator can change.
const FORMATS: AcademyPricingFormat[] = [
  { key: 'weekend_day', label: 'Weekend (No Boarding)', note: null, sort_order: 10, is_active: true, default_price_ngn: 50000 },
  { key: 'weekend_boarding', label: 'Weekend (With Boarding)', note: null, sort_order: 20, is_active: true, default_price_ngn: 80000 },
  { key: 'weekday_day', label: 'Week days (No Boarding)', note: null, sort_order: 30, is_active: true, default_price_ngn: 100000 },
  { key: 'weekday_boarding', label: 'Week days (Boarding)', note: null, sort_order: 40, is_active: true, default_price_ngn: 150000 },
  { key: 'full_time_boarding', label: '1 month - Boarding', note: null, sort_order: 50, is_active: true, default_price_ngn: 200000 },
];

// In-memory per-table fake

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let tables: Tables;
let inserts: Array<{ table: string; payload: Row }>;

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' = 'select';
  let head = false;
  const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const result = () =>
    op === 'update'
      ? { data: null, error: null }
      : head
        ? { data: null, count: rows().length, error: null }
        : { data: rows(), error: null };

  const q: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      head = Boolean(opts?.head);
      return q;
    },
    update: () => {
      op = 'update';
      return q;
    },
    eq: (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return q;
    },
    in: (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return q;
    },
    ilike: (col: string, v: string) => {
      filters.push((r) => String(r[col] ?? '').toLowerCase() === v.toLowerCase());
      return q;
    },
    not: () => q,
    or: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    insert: (payload: Row) => {
      inserts.push({ table, payload: structuredClone(payload) });
      (tables[table] ??= []).push(structuredClone(payload));
      return Promise.resolve({ error: null });
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(res, rej),
  };
  return q;
}

const fakeClient = { from: (table: string) => query(table) };

// Fixtures: two priced areas, one active-but-unlinked, one retired.
// Every stored price differs from the launch price so a fallback is visible.

const PRICES: Record<string, Record<string, number>> = {
  'area-acting': {
    weekend_day: 60000,
    weekend_boarding: 90000,
    weekday_day: 115000,
    weekday_boarding: 175000,
    full_time_boarding: 230000,
  },
  'area-editing': {
    weekend_day: 45000,
    weekend_boarding: 70000,
    weekday_day: 95000,
    weekday_boarding: 140000,
    full_time_boarding: 190000,
  },
};

// The stored price rows for one area. One per format in the catalogue,
// INCLUDING a withdrawn one: retiring a format never deletes the prices it
// carries (an application is resolved against them), so the fake must keep the
// row and the endpoint must be the thing that hides it.
function optionRows(areaId: string, formats = FORMATS) {
  return formats.map((d) => ({
    area_id: areaId,
    key: d.key,
    label: `${d.label} (${areaId})`,
    note: null,
    // numeric column: PostgREST returns a string
    price_ngn: `${PRICES[areaId][d.key] ?? d.default_price_ngn}.00`,
    sort_order: d.sort_order,
  }));
}

function seed(
  settings: Row = { registration_type: 'free', application_fee: 0 },
  formats: AcademyPricingFormat[] = FORMATS,
) {
  tables = {
    academy_pricing_formats: formats.map((f) => ({ ...f })),
    academy_settings: [{ is_active: true, application_fee_refundable: false, tuition_fee: 0, ...settings }],
    academy_batches: [
      { id: 'batch-001', batch_name: 'Batch 1', start_date: null, duration_weeks: null, status: 'open', max_students: null },
    ],
    academy_interest_areas: [
      { id: 'area-acting', slug: 'acting', label: 'Acting', description: null, fee_ngn: 250000, is_active: true, sort_order: 1 },
      { id: 'area-editing', slug: 'editing', label: 'Editing', description: null, fee_ngn: 35000, is_active: true, sort_order: 2 },
      { id: 'area-sound', slug: 'sound', label: 'Sound', description: null, fee_ngn: 0, is_active: true, sort_order: 3 },
      { id: 'area-old', slug: 'retired', label: 'Retired', description: null, fee_ngn: 0, is_active: false, sort_order: 4 },
    ],
    academy_area_pricing_options: [
      ...optionRows('area-acting', formats),
      ...optionRows('area-editing', formats),
    ],
    academy_batch_interest_areas: [
      { batch_id: 'batch-001', area_slug: 'acting' },
      { batch_id: 'batch-001', area_slug: 'editing' },
      { batch_id: 'batch-001', area_slug: 'retired' },
    ],
    academy_applications: [],
    academy_application_fee_intents: [],
    user_profiles: [],
  };
  inserts = [];
}

const USER = { id: 'user-001', email: 'student@example.com' };

function body(overrides: Row = {}) {
  return {
    full_name: 'Ada Okafor',
    email: USER.email,
    phone: '08012345678',
    batch_id: 'batch-001',
    motivation: 'I want to make films.',
    ...overrides,
  };
}

async function apply(b: Row) {
  const res = await POST(makeRequest('/api/academy/apply', { body: b }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function applicationInserts() {
  return inserts.filter((i) => i.table === 'academy_applications').map((i) => i.payload);
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  vi.mocked(requireRequestUser).mockResolvedValue(USER as never);
  vi.mocked(createAdminClient).mockReturnValue(fakeClient as never);
});

describe('GET /api/academy/apply — pricing catalogue', () => {
  beforeEach(() => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
  });

  async function catalogue() {
    const res = await GET(makeRequest('/api/academy/apply', { method: 'GET' }));
    expect(res.status).toBe(200);
    return (await res.json()) as {
      interestAreas: Array<Record<string, unknown> & { slug: string; pricing_options: Array<Record<string, unknown>> }>;
      pricingStructure: Array<Record<string, unknown>>;
    };
  }

  it('lists only active areas, each with five pricing_options at its own prices', async () => {
    const { interestAreas } = await catalogue();
    expect(interestAreas.map((a) => a.slug)).toEqual(['acting', 'editing', 'sound']);

    const acting = interestAreas.find((a) => a.slug === 'acting')!;
    expect(acting.pricing_options.map((o) => [o.key, o.price_ngn])).toEqual(
      Object.entries(PRICES['area-acting']),
    );
    const editing = interestAreas.find((a) => a.slug === 'editing')!;
    expect(editing.pricing_options.map((o) => o.price_ngn)).toEqual(
      Object.values(PRICES['area-editing']),
    );
  });

  it('gives an area with no stored rows the format default prices', async () => {
    const { interestAreas } = await catalogue();
    const sound = interestAreas.find((a) => a.slug === 'sound')!;
    expect(sound.pricing_options).toEqual(
      FORMATS.map((f) => ({
        key: f.key, label: f.label, note: f.note,
        price_ngn: f.default_price_ngn, sort_order: f.sort_order,
      })),
    );
  });

  it('does not expose the area uuid', async () => {
    const { interestAreas } = await catalogue();
    for (const a of interestAreas) expect(a).not.toHaveProperty('id');
  });

  it('publishes the format structure without prices', async () => {
    const { pricingStructure } = await catalogue();
    expect(pricingStructure).toEqual(
      FORMATS.map(({ key, label, note, sort_order }) => ({ key, label, note, sort_order })),
    );
    for (const s of pricingStructure) expect(s).not.toHaveProperty('price_ngn');
  });

  // The operator's whole point: the list is theirs. What the applicant is shown
  // and what the server will price must both follow the rows.
  it('offers a format the operator added and withdraws one they turned off', async () => {
    seed(
      { registration_type: 'free', application_fee: 0 },
      [
        ...FORMATS.map((f) => (f.key === 'weekend_boarding' ? { ...f, is_active: false } : f)),
        { key: 'summer_intensive', label: 'Summer Intensive (2 weeks)', note: 'Lagos only',
          sort_order: 5, is_active: true, default_price_ngn: 120000 },
      ],
    );
    const { interestAreas, pricingStructure } = await catalogue();
    expect(pricingStructure.map((s) => s.key)).toEqual([
      'summer_intensive', 'weekend_day', 'weekday_day', 'weekday_boarding', 'full_time_boarding',
    ]);
    const acting = interestAreas.find((a) => a.slug === 'acting')!;
    expect(acting.pricing_options.map((o) => o.key)).not.toContain('weekend_boarding');
    // The new format has no price rows of its own — it prices at its default.
    expect(acting.pricing_options[0]).toMatchObject({
      key: 'summer_intensive', label: 'Summer Intensive (2 weeks)', price_ngn: 120000,
    });
  });
});

describe('POST /api/academy/apply — area_selections', () => {
  it('prices each area from its own stored row in its own format', async () => {
    const { status } = await apply(
      body({
        area_selections: [
          { slug: 'acting', key: 'weekday_boarding' },
          { slug: 'editing', key: 'weekend_boarding' },
        ],
      }),
    );
    expect(status).toBe(201);
    const [payload] = applicationInserts();
    expect(payload.tuition_total_ngn).toBe(175000 + 70000);
    expect(payload.pricing_selections).toEqual({ acting: 'weekday_boarding', editing: 'weekend_boarding' });
    expect(payload.areas_of_interest).toEqual(['acting', 'editing']);
    // Mixed formats → no single key for the one-key column.
    expect(payload.pricing_option_key).toBeNull();
  });

  it('records the shared key when every area uses one format', async () => {
    await apply(
      body({
        area_selections: [
          { slug: 'acting', key: 'full_time_boarding' },
          { slug: 'editing', key: 'full_time_boarding' },
        ],
      }),
    );
    const [payload] = applicationInserts();
    expect(payload.tuition_total_ngn).toBe(230000 + 190000);
    expect(payload.pricing_option_key).toBe('full_time_boarding');
  });

  it('makes selections authoritative over a conflicting areas_of_interest', async () => {
    await apply(
      body({
        areas_of_interest: ['editing'],
        area_selections: [{ slug: 'acting', key: 'weekend_day' }],
      }),
    );
    const [payload] = applicationInserts();
    expect(payload.areas_of_interest).toEqual(['acting']);
    expect(payload.tuition_total_ngn).toBe(60000);
  });

  it('ignores any price or total the client sends', async () => {
    await apply(
      body({
        area_selections: [
          { slug: 'acting', key: 'weekday_day', price_ngn: 1 },
          { slug: 'editing', key: 'weekday_day', price_ngn: 1 },
        ],
        tuition_total_ngn: 1,
        total: 1,
        price_ngn: 1,
      }),
    );
    const [payload] = applicationInserts();
    expect(payload.tuition_total_ngn).toBe(115000 + 95000);
  });

  it('rejects an unknown format key with 400 and no insert', async () => {
    const { status, json } = await apply(
      body({ area_selections: [{ slug: 'acting', key: 'monthly' }] }),
    );
    expect(status).toBe(400);
    expect(json.error).toMatch(/training format on offer/i);
    expect(applicationInserts()).toHaveLength(0);
  });

  it('rejects a withdrawn format key with 400 and no insert', async () => {
    // 'weekend_boarding' is a real key with real stored rows — the operator has
    // simply taken it off the offer. Withdrawing must stop new money going into
    // it, not merely hide it from the form.
    seed({ registration_type: 'free', application_fee: 0 },
      FORMATS.map((f) => (f.key === 'weekend_boarding' ? { ...f, is_active: false } : f)));
    const { status } = await apply(
      body({ area_selections: [{ slug: 'acting', key: 'weekend_boarding' }] }),
    );
    expect(status).toBe(400);
    expect(applicationInserts()).toHaveLength(0);

    const legacy = await apply(body({ areas_of_interest: ['acting'], pricing_option_key: 'weekend_boarding' }));
    expect(legacy.status).toBe(400);
    expect(legacy.json.error).toMatch(/unknown training format/i);
  });

  it('prices in a format the operator added, from its own stored row', async () => {
    const added: AcademyPricingFormat = {
      key: 'summer_intensive', label: 'Summer Intensive (2 weeks)', note: null,
      sort_order: 5, is_active: true, default_price_ngn: 120000,
    };
    seed({ registration_type: 'free', application_fee: 0 }, [...FORMATS, added]);
    // The row seed() created prices the new format at its default; reprice this
    // training, which is what the areas console does, and the stored row must
    // win over the catalogue default.
    const row = tables.academy_area_pricing_options.find(
      (r) => r.area_id === 'area-acting' && r.key === 'summer_intensive',
    );
    expect(row).toBeDefined();
    row!.price_ngn = '132500.00';
    const { status } = await apply(
      body({ area_selections: [{ slug: 'acting', key: 'summer_intensive' }] }),
    );
    expect(status).toBe(201);
    const [payload] = applicationInserts();
    expect(payload.tuition_total_ngn).toBe(132500);
    expect(payload.pricing_option_key).toBe('summer_intensive');
  });

  it.each([
    ['a selection without a slug', [{ key: 'weekend_day' }]],
    ['a blank slug', [{ slug: '   ', key: 'weekend_day' }]],
    ['a selection without a key', [{ slug: 'acting' }]],
    ['a null entry', [null]],
    ['a string entry', ['acting']],
  ])('rejects %s with 400', async (_name, selections) => {
    const { status } = await apply(body({ area_selections: selections }));
    expect(status).toBe(400);
    expect(applicationInserts()).toHaveLength(0);
  });

  it('rejects a duplicated slug instead of pricing it twice', async () => {
    const { status, json } = await apply(
      body({
        area_selections: [
          { slug: 'acting', key: 'weekend_day' },
          { slug: 'acting', key: 'full_time_boarding' },
        ],
      }),
    );
    expect(status).toBe(400);
    // Current wording is the generic selection message, not "more than once".
    expect(json.error).toMatch(/each selection/i);
    expect(applicationInserts()).toHaveLength(0);
  });

  // Current behaviour, flagged in the PR report: a non-array (or empty)
  // area_selections is read as "legacy client", not as malformed input.
  it('treats a non-array area_selections as absent and falls back to the legacy shape', async () => {
    const { status } = await apply(
      body({
        area_selections: { acting: 'full_time_boarding' },
        areas_of_interest: ['acting'],
      }),
    );
    expect(status).toBe(201);
    const [payload] = applicationInserts();
    expect(payload.pricing_selections).toBeNull();
    expect(payload.tuition_total_ngn).toBe(60000); // weekend_day fallback, not full_time
  });

  it('rejects a non-array area_selections when there is no legacy list either', async () => {
    const { status, json } = await apply(body({ area_selections: 'acting:weekend_day' }));
    expect(status).toBe(400);
    expect(json.error).toMatch(/at least one area/i);
  });

  it('rejects more than MAX_INTEREST_AREAS_PER_APPLICATION (2) selections', async () => {
    const { status, json } = await apply(
      body({
        area_selections: [
          { slug: 'acting', key: 'weekend_day' },
          { slug: 'editing', key: 'weekend_day' },
          { slug: 'sound', key: 'weekend_day' },
        ],
      }),
    );
    expect(status).toBe(400);
    expect(json.error).toMatch(/at most 2/i);
    expect(applicationInserts()).toHaveLength(0);
  });

  it('rejects an unknown area slug', async () => {
    const { status, json } = await apply(
      body({ area_selections: [{ slug: 'forgery', key: 'weekend_day' }] }),
    );
    expect(status).toBe(400);
    expect(json.error).toMatch(/unknown area of interest: forgery/i);
    expect(applicationInserts()).toHaveLength(0);
  });

  it('rejects an inactive area even when the batch still links it', async () => {
    const { status, json } = await apply(
      body({ area_selections: [{ slug: 'retired', key: 'weekend_day' }] }),
    );
    expect(status).toBe(400);
    expect(json.error).toMatch(/unknown area of interest: retired/i);
  });

  it('rejects an active area the batch does not offer', async () => {
    const { status, json } = await apply(
      body({ area_selections: [{ slug: 'sound', key: 'weekend_day' }] }),
    );
    expect(status).toBe(400);
    expect(json.error).toMatch(/does not offer: sound/i);
    expect(applicationInserts()).toHaveLength(0);
  });

  it('prices a selection with no stored option row at the launch price (current behaviour)', async () => {
    tables.academy_area_pricing_options = tables.academy_area_pricing_options.filter(
      (r) => !(r.area_id === 'area-editing' && r.key === 'weekday_day'),
    );
    await apply(
      body({
        area_selections: [
          { slug: 'acting', key: 'weekday_day' },
          { slug: 'editing', key: 'weekday_day' },
        ],
      }),
    );
    const [payload] = applicationInserts();
    expect(payload.tuition_total_ngn).toBe(115000 + 100000);
  });
});

describe('POST /api/academy/apply — legacy pricing', () => {
  it('prices every chosen area in the single pricing_option_key format', async () => {
    await apply(body({ areas_of_interest: ['acting', 'editing'], pricing_option_key: 'weekday_day' }));
    const [payload] = applicationInserts();
    expect(payload.tuition_total_ngn).toBe(115000 + 95000);
    expect(payload.pricing_option_key).toBe('weekday_day');
    expect(payload.pricing_selections).toBeNull();
  });

  it('rejects an unknown pricing_option_key with 400 and no insert', async () => {
    const { status, json } = await apply(
      body({ areas_of_interest: ['acting'], pricing_option_key: 'monthly' }),
    );
    expect(status).toBe(400);
    expect(json.error).toMatch(/unknown training format/i);
    expect(applicationInserts()).toHaveLength(0);
  });

  it('prices a payload with no key in the cheapest format (weekend_day)', async () => {
    await apply(body({ areas_of_interest: ['acting', 'editing'] }));
    const [payload] = applicationInserts();
    expect(payload.tuition_total_ngn).toBe(105000); // 60,000 + 45,000
    // The column records what the client chose — nothing.
    expect(payload.pricing_option_key).toBeNull();
    expect(payload.pricing_selections).toBeNull();
  });

  it('falls back to the launch weekend_day price when the area has no rows', async () => {
    tables.academy_area_pricing_options = [];
    await apply(body({ areas_of_interest: ['acting'] }));
    expect(applicationInserts()[0].tuition_total_ngn).toBe(50000);
  });
});

describe('POST /api/academy/apply — frozen tuition', () => {
  it('keeps the first application total when the price row is edited later', async () => {
    const selections = [{ slug: 'acting', key: 'weekend_boarding' }];
    expect((await apply(body({ area_selections: selections }))).status).toBe(201);

    const stored = tables.academy_area_pricing_options.find(
      (r) => r.area_id === 'area-acting' && r.key === 'weekend_boarding',
    )!;
    stored.price_ngn = '120000.00';

    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-002', email: 'second@example.com' } as never);
    expect((await apply(body({ email: 'second@example.com', area_selections: selections }))).status).toBe(201);

    const [first, second] = applicationInserts();
    expect(first.tuition_total_ngn).toBe(90000);
    expect(second.tuition_total_ngn).toBe(120000);
    // The persisted first application is untouched by the repricing.
    expect(tables.academy_applications[0].tuition_total_ngn).toBe(90000);
  });
});

describe('POST /api/academy/apply — one payment at submit covers fee and tuition', () => {
  function paystackPaid(naira: number) {
    vi.mocked(verifyPaystackTransaction).mockResolvedValue({
      status: 'success',
      currency: 'NGN',
      amountKobo: naira * 100,
      customerEmail: USER.email,
    } as never);
  }

  const selections = [
    { slug: 'acting', key: 'weekday_boarding' },
    { slug: 'editing', key: 'weekend_boarding' },
  ];

  // These batches carry no installment config, so the whole tuition is due
  // alongside the application fee rather than split into instalments.
  it('charges the application fee and the full tuition in a single payment', async () => {
    seed({ registration_type: 'paid', application_fee: 5000 });
    paystackPaid(5000 + 245000);

    const { status } = await apply(body({ area_selections: selections, application_fee_reference: 'ref-5k' }));

    expect(status).toBe(201);
    expect(verifyPaystackTransaction).toHaveBeenCalledWith('ref-5k');
    const [payload] = applicationInserts();
    expect(payload.payment_status).toBe('paid');
    expect(payload.application_fee_paid).toBe(5000);
    expect(payload.tuition_total_ngn).toBe(245000);
  });

  it('rejects a payment short of the combined amount, quoting the total due', async () => {
    seed({ registration_type: 'paid', application_fee: 5000 });
    paystackPaid(4999);

    const { status, json } = await apply(
      body({ area_selections: selections, application_fee_reference: 'ref-short' }),
    );

    expect(status).toBe(400);
    expect(json.error).toContain('250,000');
    expect(applicationInserts()).toHaveLength(0);
  });
});
