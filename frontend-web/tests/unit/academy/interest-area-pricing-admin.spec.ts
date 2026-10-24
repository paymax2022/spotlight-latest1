/**
 * PUT /api/admin/academy/interest-areas — composite pricing hardening.
 *
 * A stored ₦0 (or a missing price) makes the tuition services fall back to the
 * batch training_fee_ngn — a figure the applicant never saw. So a format price
 * must be a whole number of naira, strictly positive, and fit numeric(12,2).
 * Malformed ids and duplicate keys used to surface as Postgres 500s; every
 * price change must leave an audit event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/src/lib/api/responses';

vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn(),
}));
vi.mock('@/src/server/admin/audit', () => ({ addAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { createAdminClient } from '@/lib/supabase/server';
import { PUT } from '../../../app/api/admin/academy/interest-areas/route';

const AREA_ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c0d9e8f7a6b';
const ADMIN_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

type Result = { data?: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

let calls: Call[];
let areaResult: Result;
let oldPriceResult: Result;
let upsertResult: Result;

function resultFor(table: string, op: string): Result {
  if (table === 'academy_interest_areas' && op === 'update') return areaResult;
  if (table === 'academy_area_pricing_options' && op === 'select') return oldPriceResult;
  if (table === 'academy_area_pricing_options' && op === 'upsert') return upsertResult;
  return { data: null, error: { message: `unexpected ${op} on ${table}` } };
}

function builder(table: string) {
  let op = 'select';
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'upsert', 'insert', 'eq', 'in', 'order']) {
    b[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      if (m === 'update' || m === 'upsert' || m === 'insert') op = m;
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(resultFor(table, op));
  b.single = () => Promise.resolve(resultFor(table, op));
  b.then = (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(resultFor(table, op)).then(res, rej);
  return b;
}

function put(body: unknown) {
  return PUT(
    new Request('http://localhost/api/admin/academy/interest-areas', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
      body: JSON.stringify(body),
    }),
  );
}

async function expect400(body: unknown, messagePart: RegExp) {
  const res = await put(body);
  expect(res.status).toBe(400);
  const json = (await res.json()) as { error?: string; message?: string };
  expect(JSON.stringify(json)).toMatch(messagePart);
  expect(calls.filter((c) => c.method === 'upsert')).toHaveLength(0);
  expect(calls.filter((c) => c.method === 'update')).toHaveLength(0);
}

const upsertCalls = () => calls.filter((c) => c.table === 'academy_area_pricing_options' && c.method === 'upsert');

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  areaResult = { data: { id: AREA_ID, slug: 'directing', label: 'Directing' }, error: null };
  oldPriceResult = {
    data: [
      { key: 'weekend_day', price_ngn: 50000 },
      { key: 'weekday_boarding', price_ngn: '150000.00' },
    ],
    error: null,
  };
  upsertResult = { data: null, error: null };
  vi.mocked(assertAdminPermission).mockResolvedValue({ role: 'super_admin', actorId: ADMIN_ID } as never);
  vi.mocked(createAdminClient).mockImplementation(
    () => ({ from: vi.fn((table: string) => builder(table)) }) as never,
  );
});

describe('PUT /api/admin/academy/interest-areas pricing', () => {
  it('PUT pricing rejects a zero price', async () => {
    await expect400({ id: AREA_ID, pricing: [{ key: 'weekend_day', price_ngn: 0 }] }, /weekend_day/);
  });

  it('PUT pricing rejects a negative price', async () => {
    await expect400(
      { id: AREA_ID, pricing: [{ key: 'weekend_day', price_ngn: -5000 }] },
      /Price for weekend_day must be a whole number of naira above zero/,
    );
    await expect400(
      { id: AREA_ID, pricing: [{ key: 'weekend_day', price_ngn: '-5000' }] },
      /Price for weekend_day must be a whole number of naira above zero/,
    );
  });

  it('PUT pricing rejects a fractional price', async () => {
    await expect400({ id: AREA_ID, pricing: [{ key: 'weekday_day', price_ngn: 50000.5 }] }, /weekday_day/);
    await expect400({ id: AREA_ID, pricing: [{ key: 'weekday_day', price_ngn: '50000.5' }] }, /weekday_day/);
  });

  it('PUT pricing rejects a price above 9,999,999,999', async () => {
    await expect400(
      { id: AREA_ID, pricing: [{ key: 'full_time_boarding', price_ngn: 10_000_000_000 }] },
      /full_time_boarding/,
    );
  });

  it('PUT pricing rejects non-numeric and blank prices', async () => {
    for (const bad of ['abc', '', '   ', null, true, {}, []]) {
      calls = [];
      await expect400({ id: AREA_ID, pricing: [{ key: 'weekend_boarding', price_ngn: bad }] }, /weekend_boarding/);
    }
  });

  it('PUT pricing rejects duplicate format keys', async () => {
    await expect400(
      {
        id: AREA_ID,
        pricing: [
          { key: 'weekend_day', price_ngn: 60000 },
          { key: 'weekend_day', price_ngn: 70000 },
        ],
      },
      /[Dd]uplicate.*weekend_day/,
    );
  });

  it('PUT pricing rejects an unknown format key', async () => {
    await expect400(
      { id: AREA_ID, pricing: [{ key: 'evening_class', price_ngn: 60000 }] },
      /Unknown pricing format: evening_class/,
    );
  });

  it('PUT pricing accepts only plain digit strings', async () => {
    for (const bad of ['1e5', '0x10', '1.0', '0b11', ' ', ' 1e3 ', '1e-0', '0x186A0']) {
      calls = [];
      await expect400(
        { id: AREA_ID, pricing: [{ key: 'weekday_day', price_ngn: bad }] },
        /Price for weekday_day must be a whole number of naira above zero/,
      );
    }
    for (const [good, expected] of [['50000', 50000], [' 50000 ', 50000]] as const) {
      calls = [];
      const res = await put({ id: AREA_ID, pricing: [{ key: 'weekday_day', price_ngn: good }] });
      expect(res.status).toBe(200);
      const [rows] = upsertCalls()[0].args as [Array<Record<string, unknown>>];
      expect(rows[0]).toMatchObject({ key: 'weekday_day', price_ngn: expected });
    }
  });

  it('upsert error returns 500 and writes no audit event', async () => {
    upsertResult = { data: null, error: { message: 'boom', code: 'XX000' } };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await put({ id: AREA_ID, pricing: [{ key: 'weekend_day', price_ngn: 65000 }] });
    errSpy.mockRestore();
    expect(res.status).toBe(500);
    expect(upsertCalls()).toHaveLength(1);
    expect(addAuditEvent).not.toHaveBeenCalled();
  });

  it('PUT skips the audit event when no price changed', async () => {
    // Stored: weekend_day 50000, weekday_boarding '150000.00' (numeric comes back as a string).
    const res = await put({
      id: AREA_ID,
      pricing: [
        { key: 'weekend_day', price_ngn: 50000 },
        { key: 'weekday_boarding', price_ngn: 150000 },
      ],
    });
    expect(res.status).toBe(200);
    expect(upsertCalls()).toHaveLength(1);
    expect(addAuditEvent).not.toHaveBeenCalled();

    // A key with no stored row counts as a change.
    vi.mocked(addAuditEvent).mockClear();
    const res2 = await put({
      id: AREA_ID,
      pricing: [
        { key: 'weekend_day', price_ngn: 50000 },
        { key: 'full_time_boarding', price_ngn: 200000 },
      ],
    });
    expect(res2.status).toBe(200);
    expect(addAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('PUT rejects a non-UUID id before touching the database', async () => {
    for (const id of ['abc', '123', `${AREA_ID}x`, "'; drop table x; --"]) {
      const res = await put({ id, label: 'Directing' });
      expect(res.status).toBe(400);
    }
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('PUT pricing upserts positive whole-naira prices', async () => {
    const res = await put({
      id: AREA_ID.toUpperCase(),
      pricing: [
        { key: 'weekend_day', price_ngn: 65000, label: 'HACKED', note: 'x', sort_order: 999 },
        { key: 'weekday_boarding', price_ngn: '175000' },
      ],
    });
    expect(res.status).toBe(200);
    const ups = upsertCalls();
    expect(ups).toHaveLength(1);
    const [rows, opts] = ups[0].args as [Array<Record<string, unknown>>, Record<string, unknown>];
    expect(opts).toEqual({ onConflict: 'area_id,key' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      area_id: AREA_ID.toUpperCase(),
      key: 'weekend_day',
      price_ngn: 65000,
      label: 'Weekend (No Boarding)',
      note: null,
      sort_order: 10,
    });
    expect(rows[1]).toMatchObject({
      key: 'weekday_boarding',
      price_ngn: 175000,
      label: 'Week days (Boarding)',
      sort_order: 40,
    });
  });

  it('PUT writes an audit event with old and new prices', async () => {
    const res = await put({
      id: AREA_ID,
      pricing: [
        { key: 'weekend_day', price_ngn: 65000 },
        { key: 'weekday_boarding', price_ngn: 175000 },
      ],
    });
    expect(res.status).toBe(200);
    expect(addAuditEvent).toHaveBeenCalledTimes(1);
    expect(addAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUser: ADMIN_ID,
        role: 'super_admin',
        module: 'academy',
        entityType: 'academy_area_pricing_options',
        entityId: AREA_ID,
        action: 'academy.area_pricing.update',
        oldValue: { weekend_day: 50000, weekday_boarding: 150000 },
        newValue: { weekend_day: 65000, weekday_boarding: 175000 },
      }),
    );
    // The old-price read is a single SELECT scoped to this area and the touched keys.
    const reads = calls.filter((c) => c.table === 'academy_area_pricing_options' && c.method === 'select');
    expect(reads).toHaveLength(1);
    expect(calls).toContainEqual({ table: 'academy_area_pricing_options', method: 'eq', args: ['area_id', AREA_ID] });
  });

  it('PUT still saves when the old-price read fails', async () => {
    oldPriceResult = { data: null, error: { message: 'boom', code: 'XX000' } };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await put({ id: AREA_ID, pricing: [{ key: 'weekend_day', price_ngn: 65000 }] });
    errSpy.mockRestore();
    expect(res.status).toBe(200);
    expect(upsertCalls()).toHaveLength(1);
    expect(addAuditEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(addAuditEvent).mock.calls[0][0];
    expect(event.oldValue).toBeUndefined();
    expect(event.newValue).toEqual({ weekend_day: 65000 });
  });

  it('PUT without pricing still updates label/description as before', async () => {
    const res = await put({ id: AREA_ID, label: '  Cinematography ', description: 'Lenses', is_active: false, sort_order: '3' });
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.table === 'academy_interest_areas' && c.method === 'update');
    expect(update?.args[0]).toMatchObject({
      label: 'Cinematography',
      description: 'Lenses',
      is_active: false,
      sort_order: 3,
    });
    expect(calls).toContainEqual({ table: 'academy_interest_areas', method: 'eq', args: ['id', AREA_ID] });
    expect(calls.some((c) => c.table === 'academy_area_pricing_options')).toBe(false);
    expect(addAuditEvent).not.toHaveBeenCalled();
  });

  it('403 when the permission check rejects, with no database call', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await put({ id: AREA_ID, pricing: [{ key: 'weekend_day', price_ngn: 65000 }] });
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(addAuditEvent).not.toHaveBeenCalled();
  });
});
