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
function makeClient(selects: Record<string, string[]>, appError: (cols: string) => AppError = () => null) {
  const rows: Record<string, unknown> = {
    academy_applications: {
      id: 'app-1',
      status: 'pending',
      created_at: '2026-10-24T00:00:00Z',
      areas_of_interest: [],
      selected_options: SNAPSHOT,
    },
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
            } else if (!cols.includes('selected_options')) {
              // A pre-migration DB has no such column to return.
              const { selected_options: _omit, ...rest } = rows[table] as Record<string, unknown>;
              result = { data: rest, error: null };
            }
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
