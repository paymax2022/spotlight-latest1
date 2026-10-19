/**
 * POST /estate/emergencies/[id]/resolve — role gate.
 *
 * Before the fix any resident of the estate could close another resident's
 * open panic alert. Product decision (2026-10-15): only the estate manager
 * (estate_residents.role = 'estate_admin') may resolve an alert.
 *
 * Uses the real getResidentContext/resolveNames against an in-memory fake
 * Supabase client so the residency lookup is exercised, not mocked away.
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

import { POST } from '../../../app/api/v1/estate/emergencies/[id]/resolve/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

const ALERT_ID = '11111111-2222-3333-4444-555555555555';
const ESTATE_A = 'estate-a';
const ESTATE_B = 'estate-b';
const REPORTER = 'reporter-1';

type Row = Record<string, any>;

function fakeSupabase(tables: Record<string, Row[]>) {
  const updates: Array<{ table: string; patch: Row }> = [];
  const from = (table: string) => {
    const filters: Array<[string, any]> = [];
    let patch: Row | null = null;
    let inFilter: [string, any[]] | null = null;
    const matches = () =>
      (tables[table] ?? []).filter(
        (r) => filters.every(([c, v]) => r[c] === v) && (!inFilter || inFilter[1].includes(r[inFilter[0]])),
      );
    const q: any = {
      select: () => q,
      update: (p: Row) => {
        patch = p;
        updates.push({ table, patch: p });
        return q;
      },
      eq: (c: string, v: any) => (filters.push([c, v]), q),
      in: (c: string, v: any[]) => ((inFilter = [c, v]), q),
      limit: () => q,
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      single: async () => {
        const hit = matches()[0];
        if (hit && patch) Object.assign(hit, patch);
        return { data: hit ?? null, error: null };
      },
      then: (res: any) => res({ data: matches(), error: null }),
    };
    return q;
  };
  return { client: { from }, updates };
}

function seed(callerRole: string | null, callerEstate = ESTATE_A) {
  const tables: Record<string, Row[]> = {
    estate_residents: callerRole ? [{ user_id: 'caller', estate_id: callerEstate, unit: '1', role: callerRole }] : [],
    estate_emergency_alerts: [
      { id: ALERT_ID, estate_id: ESTATE_A, reporter_id: REPORTER, kind: 'panic', status: 'open', created_at: 'now' },
    ],
    user_profiles: [{ id: REPORTER, full_name: 'Reporter One' }],
  };
  const fake = fakeSupabase(tables);
  vi.mocked(createAdminClient).mockReturnValue(fake.client as any);
  return { ...fake, tables };
}

const call = (id = ALERT_ID) =>
  POST(new Request('http://x/resolve', { method: 'POST' }), { params: Promise.resolve({ id }) });

describe('POST /estate/emergencies/[id]/resolve', () => {
  beforeEach(() => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'caller', email: 'c@e.com' } as any);
  });

  it('refuses a plain resident with 403 and issues no update', async () => {
    const { updates, tables } = seed('resident');
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/estate admin/i);
    expect(updates).toHaveLength(0);
    expect(tables.estate_emergency_alerts[0].status).toBe('open');
  });

  it('lets an estate_admin of the same estate resolve the alert', async () => {
    const { updates, tables } = seed('estate_admin');
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('resolved');
    expect(updates).toEqual([{ table: 'estate_emergency_alerts', patch: { status: 'resolved' } }]);
    expect(tables.estate_emergency_alerts[0].status).toBe('resolved');
  });

  it('refuses an estate_admin of a different estate (404) and issues no update', async () => {
    const { updates, tables } = seed('estate_admin', ESTATE_B);
    const res = await call();
    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
    expect(tables.estate_emergency_alerts[0].status).toBe('open');
  });

  it('refuses a non-resident with 403 and issues no update', async () => {
    const { updates } = seed(null);
    const res = await call();
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('still rejects a malformed id with 400 for an admin', async () => {
    seed('estate_admin');
    expect((await call('not-a-uuid')).status).toBe(400);
  });
});
