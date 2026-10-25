/**
 * POST /estate/facilities/bookings — slot conflict guard (EST-UAT-0248).
 *
 * Two residents must not hold overlapping active bookings beyond the
 * facility's capacity: capacity 1 (or unset) means exclusive use; cancelled
 * bookings release the slot.
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

import { POST } from '../../../app/api/v1/estate/facilities/bookings/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

type Row = Record<string, any>;

const ESTATE = 'estate-a';
const FACILITY = 'fac-1';
const FUTURE = { startsAt: '2099-01-01T10:00:00Z', endsAt: '2099-01-01T12:00:00Z' };

function fakeSupabase(tables: Record<string, Row[]>) {
  const inserts: Array<{ table: string; rows: Row[] }> = [];
  const from = (table: string) => {
    const filters: Array<[string, any]> = [];
    const ins: Array<[string, any[]]> = [];
    const lts: Array<[string, any]> = [];
    const gts: Array<[string, any]> = [];
    let pendingInsert: Row[] | null = null;
    const matches = () =>
      (tables[table] ?? []).filter(
        (r) =>
          filters.every(([c, v]) => r[c] === v) &&
          ins.every(([c, vs]) => vs.includes(r[c])) &&
          lts.every(([c, v]) => r[c] < v) &&
          gts.every(([c, v]) => r[c] > v),
      );
    const q: any = {
      select: () => q,
      insert: (rows: Row[] | Row) => {
        pendingInsert = Array.isArray(rows) ? rows : [rows];
        return q;
      },
      update: () => q,
      eq: (c: string, v: any) => (filters.push([c, v]), q),
      in: (c: string, v: any[]) => (ins.push([c, v]), q),
      // `.is(col, null)` matches rows where the column is null or absent.
      is: (c: string, v: any) => (ins.push([c, v === null ? [null, undefined] : [v]]), q),
      lt: (c: string, v: any) => (lts.push([c, v]), q),
      gt: (c: string, v: any) => (gts.push([c, v]), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      single: async () => {
        if (pendingInsert) {
          tables[table] = [...(tables[table] ?? []), ...pendingInsert];
          inserts.push({ table, rows: pendingInsert });
          return { data: pendingInsert[0], error: null };
        }
        return { data: matches()[0] ?? null, error: null };
      },
      then: (res: any) => res({ data: matches(), error: null }),
    };
    return q;
  };
  return { client: { from }, inserts };
}

function seed(bookings: Row[], capacity: number | null = 1) {
  const tables: Record<string, Row[]> = {
    // Writes pass the estate lifecycle gate (ESTD-D025): only an active estate is writable.
    estates: [{ id: ESTATE, status: 'active' }],
    estate_residents: [{ user_id: 'caller', estate_id: ESTATE, unit: '1', role: 'resident' }],
    estate_facilities: [{ id: FACILITY, estate_id: ESTATE, name: 'Hall', fee_kobo: 0, capacity }],
    facility_bookings: bookings,
  };
  const fake = fakeSupabase(tables);
  vi.mocked(createAdminClient).mockReturnValue(fake.client as any);
  return { ...fake, tables };
}

const call = (body: any = { facilityId: FACILITY, ...FUTURE }) =>
  POST(
    new Request('http://x/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem-1', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('POST /estate/facilities/bookings - conflict guard', () => {
  beforeEach(() => {
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'caller', email: 'c@e.com' } as any);
  });

  it('rejects an overlapping booking when the facility is already reserved (409)', async () => {
    seed([{ id: 'b1', estate_id: ESTATE, facility_id: FACILITY, resident_id: 'other', status: 'confirmed', starts_at: '2099-01-01T11:00:00Z', ends_at: '2099-01-01T13:00:00Z' }]);
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already booked/i);
  });

  it('also counts pending bookings as holding the slot', async () => {
    seed([{ id: 'b1', estate_id: ESTATE, facility_id: FACILITY, resident_id: 'other', status: 'pending', starts_at: '2099-01-01T11:00:00Z', ends_at: '2099-01-01T13:00:00Z' }]);
    expect((await call()).status).toBe(409);
  });

  it('accepts the booking when the only prior booking was cancelled', async () => {
    const { inserts } = seed([{ id: 'b1', estate_id: ESTATE, facility_id: FACILITY, resident_id: 'other', status: 'cancelled', starts_at: '2099-01-01T11:00:00Z', ends_at: '2099-01-01T13:00:00Z' }]);
    const res = await call();
    expect(res.status).toBe(201);
    expect(inserts).toHaveLength(1);
  });

  it('accepts a non-overlapping booking on an exclusive facility', async () => {
    seed([{ id: 'b1', estate_id: ESTATE, facility_id: FACILITY, resident_id: 'other', status: 'confirmed', starts_at: '2099-01-02T10:00:00Z', ends_at: '2099-01-02T12:00:00Z' }]);
    expect((await call()).status).toBe(201);
  });

  it('allows a second overlapping booking when capacity permits', async () => {
    seed(
      [{ id: 'b1', estate_id: ESTATE, facility_id: FACILITY, resident_id: 'other', status: 'confirmed', starts_at: '2099-01-01T11:00:00Z', ends_at: '2099-01-01T13:00:00Z' }],
      2,
    );
    expect((await call()).status).toBe(201);
  });

  it('rejects the third overlapping booking at capacity two', async () => {
    seed(
      [
        { id: 'b1', estate_id: ESTATE, facility_id: FACILITY, resident_id: 'a', status: 'confirmed', starts_at: '2099-01-01T11:00:00Z', ends_at: '2099-01-01T13:00:00Z' },
        { id: 'b2', estate_id: ESTATE, facility_id: FACILITY, resident_id: 'b', status: 'confirmed', starts_at: '2099-01-01T11:30:00Z', ends_at: '2099-01-01T12:30:00Z' },
      ],
      2,
    );
    expect((await call()).status).toBe(409);
  });

  it('still requires the Idempotency-Key header', async () => {
    seed([]);
    const res = await POST(
      new Request('http://x/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId: FACILITY, ...FUTURE }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
