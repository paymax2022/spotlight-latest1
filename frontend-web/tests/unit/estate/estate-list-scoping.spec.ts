/**
 * List-endpoint scoping for estate residents (EST-UAT-0327, -0273/-0274).
 *
 * - GET /estate/emergencies: responders (estate_admin, estate_security) see the
 *   estate-wide feed; ordinary residents see only their own alerts.
 * - GET /estate/repairs: non-admin residents see only their own tickets.
 * - GET /estate/vendors: residents see verified vendors only.
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

import { GET as listEmergencies } from '../../../app/api/v1/estate/emergencies/route';
import { GET as listRepairs } from '../../../app/api/v1/estate/repairs/route';
import { GET as listVendors } from '../../../app/api/v1/estate/vendors/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

type Row = Record<string, any>;
const ESTATE = 'estate-a';

function fakeSupabase(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<[string, any]> = [];
    const ins: Array<[string, any[]]> = [];
    const matches = () =>
      (tables[table] ?? []).filter(
        (r) => filters.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
      );
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (filters.push([c, v]), q),
      in: (c: string, v: any[]) => (ins.push([c, v]), q),
      // `.is(col, null)` matches rows where the column is null or absent.
      is: (c: string, v: any) => (ins.push([c, v === null ? [null, undefined] : [v]]), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      single: async () => ({ data: matches()[0] ?? null, error: null }),
      then: (res: any) => res({ data: matches(), error: null }),
    };
    return q;
  };
  return { from };
}

function seed(role: string | null) {
  const tables: Record<string, Row[]> = {
    estate_residents: role ? [{ user_id: 'caller', estate_id: ESTATE, unit: '1', role }] : [],
    estate_emergency_alerts: [
      { id: 'a1', estate_id: ESTATE, reporter_id: 'caller', kind: 'panic', status: 'open', created_at: 't1' },
      { id: 'a2', estate_id: ESTATE, reporter_id: 'other', kind: 'medical', description: 'private', status: 'open', created_at: 't2' },
    ],
    estate_repair_requests: [
      { id: 'r1', estate_id: ESTATE, reporter_id: 'caller', category: 'plumbing', description: 'mine', urgency: 'low', status: 'reported', created_at: 't1' },
      { id: 'r2', estate_id: ESTATE, reporter_id: 'other', category: 'electrical', description: 'theirs', urgency: 'high', status: 'reported', created_at: 't2' },
    ],
    estate_vendors: [
      { id: 'v1', estate_id: ESTATE, name: 'Good Plumber', category: 'plumbing', status: 'verified', rating: 4.5 },
      { id: 'v2', estate_id: ESTATE, name: 'Pending Painter', category: 'paint', status: 'pending', rating: 0 },
      { id: 'v3', estate_id: ESTATE, name: 'Bad Sparky', category: 'electrical', status: 'suspended', rating: 1 },
    ],
    user_profiles: [],
  };
  vi.mocked(createAdminClient).mockReturnValue(fakeSupabase(tables) as any);
}

const get = (path: string) => new Request(`http://x${path}`);

describe('estate list scoping', () => {
  beforeEach(() => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'caller', email: 'c@e.com' } as any);
  });

  it('emergencies: a resident sees only their own alerts', async () => {
    seed('resident');
    const res = await listEmergencies(get('/emergencies'));
    const rows = await res.json();
    expect(rows.map((r: any) => r.id)).toEqual(['a1']);
  });

  it('emergencies: an estate admin sees the full feed', async () => {
    seed('estate_admin');
    const res = await listEmergencies(get('/emergencies'));
    expect((await res.json()).map((r: any) => r.id)).toEqual(['a1', 'a2']);
  });

  it('emergencies: estate security sees the full feed', async () => {
    seed('estate_security');
    const res = await listEmergencies(get('/emergencies'));
    expect((await res.json()).map((r: any) => r.id)).toEqual(['a1', 'a2']);
  });

  it('repairs: a resident sees only their own tickets', async () => {
    seed('resident');
    const res = await listRepairs(get('/repairs'));
    expect((await res.json()).map((r: any) => r.id)).toEqual(['r1']);
  });

  it('repairs: an admin sees the estate-wide queue', async () => {
    seed('estate_admin');
    const res = await listRepairs(get('/repairs'));
    expect((await res.json()).map((r: any) => r.id)).toEqual(['r1', 'r2']);
  });

  it('vendors: a resident sees verified vendors only', async () => {
    seed('resident');
    const res = await listVendors(get('/vendors'));
    expect((await res.json()).map((v: any) => v.id)).toEqual(['v1']);
  });

  it('vendors: an admin sees pending and suspended vendors for review', async () => {
    seed('estate_admin');
    const res = await listVendors(get('/vendors'));
    expect((await res.json()).map((v: any) => v.id).sort()).toEqual(['v1', 'v2', 'v3']);
  });
});
