/**
 * Vendor-job authorization (EST-UAT-0280/-0285).
 *
 * GET /estate/vendors/jobs and POST /estate/vendors/jobs/[id]/status previously
 * let any estate resident read every job (vendor names + amounts) and move any
 * job through its lifecycle. Jobs are now scoped: estate admin sees/drives all,
 * a vendor sees/drives only its own awarded jobs, other residents get 403.
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

import { GET as listJobs } from '../../../app/api/v1/estate/vendors/jobs/route';
import { POST as setStatus } from '../../../app/api/v1/estate/vendors/jobs/[id]/status/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

type Row = Record<string, any>;
const ESTATE = 'estate-a';
const JOB_ID = '11111111-2222-3333-4444-555555555555';

function fakeSupabase(tables: Record<string, Row[]>) {
  const updates: Array<{ table: string; patch: Row }> = [];
  const from = (table: string) => {
    const filters: Array<[string, any]> = [];
    const ins: Array<[string, any[]]> = [];
    let patch: Row | null = null;
    const matches = () =>
      (tables[table] ?? []).filter(
        (r) => filters.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
      );
    const q: any = {
      select: () => q,
      update: (p: Row) => {
        patch = p;
        updates.push({ table, patch: p });
        return q;
      },
      eq: (c: string, v: any) => (filters.push([c, v]), q),
      in: (c: string, v: any[]) => (ins.push([c, v]), q),
      order: () => q,
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

function seed(role: string) {
  const tables: Record<string, Row[]> = {
    estate_residents: [{ user_id: 'caller', estate_id: ESTATE, unit: '1', role }],
    estate_vendors: [
      { id: 'v-mine', estate_id: ESTATE, user_id: 'caller', name: 'My Plumbing Co', status: 'verified' },
      { id: 'v-other', estate_id: ESTATE, user_id: 'someone-else', name: 'Rival Works', status: 'verified' },
    ],
    vendor_jobs: [
      { id: JOB_ID, estate_id: ESTATE, vendor_id: 'v-mine', status: 'available', amount_kobo: 5000, created_at: 't1' },
      { id: '22222222-2222-3333-4444-555555555555', estate_id: ESTATE, vendor_id: 'v-other', status: 'available', amount_kobo: 9000, created_at: 't2' },
    ],
  };
  const fake = fakeSupabase(tables);
  vi.mocked(createAdminClient).mockReturnValue(fake.client as any);
  return { ...fake, tables };
}

const getCall = () => listJobs(new Request('http://x/jobs'));
const postCall = (status = 'accepted', id = JOB_ID) =>
  setStatus(
    new Request('http://x/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('GET /estate/vendors/jobs', () => {
  beforeEach(() => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'caller', email: 'c@e.com' } as any);
  });

  it('returns 403 to a plain resident (no awarded work)', async () => {
    seed('resident');
    // remove caller's vendor row so they are a plain resident
    const fake = fakeSupabase({
      estate_residents: [{ user_id: 'caller', estate_id: ESTATE, unit: '1', role: 'resident' }],
      estate_vendors: [{ id: 'v-other', estate_id: ESTATE, user_id: 'someone-else', name: 'Rival', status: 'verified' }],
      vendor_jobs: [{ id: JOB_ID, estate_id: ESTATE, vendor_id: 'v-other', status: 'available', amount_kobo: 1, created_at: 't' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(fake.client as any);
    expect((await getCall()).status).toBe(403);
  });

  it('scopes a vendor to its own jobs only', async () => {
    seed('resident');
    const res = await getCall();
    const rows = await res.json();
    expect(rows.map((j: any) => j.id)).toEqual([JOB_ID]);
    expect(rows[0].vendorName).toBe('My Plumbing Co');
  });

  it('lets an estate admin see all jobs', async () => {
    seed('estate_admin');
    const res = await getCall();
    expect((await res.json())).toHaveLength(2);
  });
});

describe('POST /estate/vendors/jobs/[id]/status', () => {
  beforeEach(() => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'caller', email: 'c@e.com' } as any);
  });

  it('lets the owning vendor accept its job', async () => {
    const { updates } = seed('resident');
    const res = await postCall('accepted');
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ table: 'vendor_jobs', patch: { status: 'accepted' } }]);
  });

  it('forbids a vendor from touching another vendor\'s job', async () => {
    const { updates } = seed('resident');
    const res = await postCall('accepted', '22222222-2222-3333-4444-555555555555');
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('lets an estate admin drive any job', async () => {
    seed('estate_admin');
    const res = await postCall('in_progress', '22222222-2222-3333-4444-555555555555');
    expect(res.status).toBe(200);
  });

  it('still blocks writing the paid status directly', async () => {
    const { updates } = seed('estate_admin');
    const res = await postCall('paid');
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });
});
