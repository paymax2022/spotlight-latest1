/**
 * GET /api/academy/application must return the application's `selected_options`
 * snapshot (the server-priced area options chosen at apply time) so the mobile
 * status screen can show option + boarding per area.
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

import { GET } from '../../../app/api/academy/application/route';
import { createAdminClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/src/lib/auth/request';

const SNAPSHOT = [
  {
    area_slug: 'directing',
    option_id: 'opt-1',
    label: 'Foundation',
    duration_label: '4 weeks',
    boarding: true,
    price_ngn: 150000,
  },
];

type AppError = { code?: string; message: string } | null;

/**
 * Table-aware chainable fake; records every select() column list per table.
 * `appError(cols)` lets a test fail the academy_applications lookup for a
 * given column list (e.g. the column not existing before the migration).
 */
function makeClient(
  selects: Record<string, string[]>,
  appError: (cols: string) => AppError = () => null,
  opts: { areas?: string[]; pricingOptionsError?: AppError } = {},
) {
  const rows: Record<string, unknown> = {
    academy_applications: {
      id: 'app-1',
      status: 'pending',
      created_at: '2026-10-24T00:00:00Z',
      areas_of_interest: opts.areas ?? [],
      selected_options: SNAPSHOT,
      pricing_selections: null,
    },
    academy_interest_areas: [{ id: 'area-1', slug: 'directing', label: 'Directing', fee_ngn: 70000 }],
    academy_area_pricing_options: [],
    academy_application_status_history: [],
    academy_installment_plans: null,
    academy_enrollments: null,
  };
  return {
    from(table: string) {
      let result: { data: unknown; error: AppError } = { data: rows[table] ?? null, error: null };
      const b: any = {
        select(cols: string) {
          (selects[table] ??= []).push(cols);
          if (table === 'academy_applications') {
            const err = appError(cols);
            if (err) {
              result = { data: null, error: err };
            } else {
              // A pre-migration DB has no such columns to return.
              const rest = { ...(rows[table] as Record<string, unknown>) };
              if (!cols.includes('selected_options')) delete rest.selected_options;
              if (!cols.includes('pricing_selections')) delete rest.pricing_selections;
              result = { data: rest, error: null };
            }
          }
          if (table === 'academy_area_pricing_options' && opts.pricingOptionsError) {
            result = { data: null, error: opts.pricingOptionsError };
          }
          return b;
        },
        eq: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        update: () => b,
        maybeSingle: async () => result,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
      return b;
    },
  };
}

describe('GET /api/academy/application — selected_options', () => {
  let selects: Record<string, string[]>;
  beforeEach(() => {
    selects = {};
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 'a@example.com' } as never);
    vi.mocked(createAdminClient).mockReturnValue(makeClient(selects) as never);
  });

  it('selects and returns the selected_options snapshot', async () => {
    const res = await GET(makeRequest('/api/academy/application'));
    expect(res.status).toBe(200);
    expect(selects.academy_applications?.[0]).toContain('selected_options');
    const body = await res.json();
    expect(body.application.selected_options).toEqual(SNAPSHOT);
  });

  it('status route falls back when selected_options column is missing (42703)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeClient(selects, (cols) =>
        cols.includes('selected_options')
          ? { code: '42703', message: 'column academy_applications.selected_options does not exist' }
          : null,
      ) as never,
    );
    const res = await GET(makeRequest('/api/academy/application'));
    expect(res.status).toBe(200);
    expect(selects.academy_applications).toHaveLength(2);
    expect(selects.academy_applications[1]).not.toContain('selected_options');
    const body = await res.json();
    expect(body.application.id).toBe('app-1');
    expect(body.application.selected_options ?? null).toBeNull();
  });

  it('other errors still fail', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeClient(selects, () => ({ code: '08006', message: 'connection failure' })) as never,
    );
    const res = await GET(makeRequest('/api/academy/application'));
    expect(res.status).toBe(500);
    expect(selects.academy_applications).toHaveLength(1);
  });
});

describe('GET /api/academy/application — pre-migration tolerance', () => {
  let selects: Record<string, string[]>;
  beforeEach(() => {
    selects = {};
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 'a@example.com' } as never);
  });

  const missing = (column: string) => (cols: string) =>
    cols.includes(column)
      ? { code: '42703', message: `column academy_applications.${column} does not exist` }
      : null;

  it.each(['pricing_selections', 'selected_options'])(
    'retries once without BOTH optional columns when %s is missing (42703)',
    async (column) => {
      vi.mocked(createAdminClient).mockReturnValue(makeClient(selects, missing(column)) as never);
      const res = await GET(makeRequest('/api/academy/application'));
      expect(res.status).toBe(200);
      expect(selects.academy_applications).toHaveLength(2);
      expect(selects.academy_applications[1]).not.toContain('selected_options');
      expect(selects.academy_applications[1]).not.toContain('pricing_selections');
    },
  );

  it('a migrations-only DB (both columns missing) still loads the status screen', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeClient(selects, (cols) =>
        cols.includes('pricing_selections') || cols.includes('selected_options')
          ? { code: '42703', message: 'column academy_applications.pricing_selections does not exist' }
          : null,
      ) as never,
    );
    const res = await GET(makeRequest('/api/academy/application'));
    expect(res.status).toBe(200);
    expect(selects.academy_applications).toHaveLength(2);
  });

  it('42703 for an unrelated column is NOT swallowed (500, no retry)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeClient(selects, missing('tuition_total_ngn')) as never);
    const res = await GET(makeRequest('/api/academy/application'));
    expect(res.status).toBe(500);
    expect(selects.academy_applications).toHaveLength(1);
  });

  it('a non-missing-column error that merely mentions selected_options is NOT swallowed', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeClient(selects, () => ({ code: '57014', message: 'canceling statement due to timeout (selected_options)' })) as never,
    );
    const res = await GET(makeRequest('/api/academy/application'));
    expect(res.status).toBe(500);
    expect(selects.academy_applications).toHaveLength(1);
  });

  it.each(['PGRST205', '42P01'])(
    'treats a missing academy_area_pricing_options table (%s) as no options',
    async (code) => {
      vi.mocked(createAdminClient).mockReturnValue(
        makeClient(selects, () => null, {
          areas: ['directing'],
          pricingOptionsError: { code, message: 'academy_area_pricing_options missing' },
        }) as never,
      );
      const res = await GET(makeRequest('/api/academy/application'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.areas).toEqual([
        { slug: 'directing', label: 'Directing', optionKey: null, optionLabel: null, priceNgn: 70000 },
      ]);
    },
  );

  it('any other academy_area_pricing_options error still fails (500)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeClient(selects, () => null, {
        areas: ['directing'],
        pricingOptionsError: { code: '08006', message: 'connection failure' },
      }) as never,
    );
    const res = await GET(makeRequest('/api/academy/application'));
    expect(res.status).toBe(500);
  });
});
