/**
 * /api/admin/academy/pricing-formats — the operator's tuition-format catalogue.
 *
 * Under test: the collection route (list, create, reorder) and the item route
 * (rename, reprice, withdraw, delete). The rules that matter are the ones that
 * protect money and history:
 *   · `key` is written into academy_applications and cannot be edited later;
 *   · a format an application was priced in cannot be deleted, only withdrawn;
 *   · withdrawing the last format on offer would empty the apply form;
 *   · a rename fans out to academy_area_pricing_options (the stored wording a
 *     past application renders), but a WITHDRAWAL must not rewrite history;
 *   · a read that could not be performed is a refusal, never a pass — that is
 *     what stands between an unverified assumption and an irreversible delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/src/lib/api/responses';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/server/admin/audit', () => ({ addAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { createAdminClient } from '@/lib/supabase/server';
import {
  GET as listFormats,
  POST as createFormat,
  PUT as reorderFormats,
} from '../../../app/api/admin/academy/pricing-formats/route';
import {
  PUT as updateFormat,
  DELETE as deleteFormat,
} from '../../../app/api/admin/academy/pricing-formats/[key]/route';
import { countApplicationsUsingFormat } from '@/src/server/services/academy/formats';

const ADMIN_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

type Row = Record<string, unknown>;

let tables: Record<string, Row[]>;
let writes: Array<{ table: string; method: string; payload?: unknown }>;
// Read failures are per table so a test can make exactly one of the three reads
// (catalogue, per-format, application history) unavailable.
let formatsListError: unknown;
let formatsRowError: unknown;
let applicationsError: unknown;
let areasError: unknown;
let optionsWriteError: unknown;

function errorFor(table: string): unknown {
  if (table === 'academy_pricing_formats') return formatsListError;
  if (table === 'academy_applications') return applicationsError;
  if (table === 'academy_interest_areas') return areasError;
  return null;
}

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
  let payload: Row | Row[] | undefined;
  let headCount = false;
  const rows = () => (tables[table] ?? []).filter((r) => filters.every((fn) => fn(r)));

  const q: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean; count?: string }) => {
      headCount = opts?.head === true || opts?.count === 'exact';
      return q;
    },
    insert: (p: Row) => {
      op = 'insert';
      payload = p;
      writes.push({ table, method: 'insert', payload });
      if (table === 'academy_pricing_formats' && (tables[table] ?? []).some((r) => r.key === p.key)) {
        return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint', code: '23505' } });
      }
      (tables[table] ??= []).push(structuredClone(p));
      return Promise.resolve({ error: null });
    },
    upsert: (p: Row | Row[]) => {
      op = 'upsert';
      payload = p;
      writes.push({ table, method: 'upsert', payload });
      if (table === 'academy_area_pricing_options' && optionsWriteError) {
        return Promise.resolve({ error: optionsWriteError });
      }
      for (const row of Array.isArray(p) ? p : [p]) (tables[table] ??= []).push(structuredClone(row));
      return Promise.resolve({ error: null });
    },
    update: (p: Row) => {
      op = 'update';
      payload = p;
      writes.push({ table, method: 'update', payload });
      return q;
    },
    delete: () => {
      op = 'delete';
      writes.push({ table, method: 'delete' });
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
    // The application-history count is an OR over pricing_option_key and one
    // jsonb containment per training slug. The fake answers with the whole
    // table, which is what a non-zero refusal needs.
    or: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => {
      if (table === 'academy_pricing_formats' && formatsRowError) {
        return Promise.resolve({ data: null, error: formatsRowError });
      }
      return Promise.resolve({ data: rows()[0] ?? null, error: null });
    },
    single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const failure = errorFor(table);
      if (op === 'select' && failure) {
        return Promise.resolve({ data: null, count: 0, error: failure }).then(res, rej);
      }
      if (op === 'select' && headCount) {
        return Promise.resolve({ data: null, count: rows().length, error: null }).then(res, rej);
      }
      if (op === 'update') {
        for (const r of rows()) Object.assign(r, payload as Row);
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      }
      if (op === 'delete') {
        const list = tables[table] ?? [];
        tables[table] = list.filter((r) => !filters.every((fn) => fn(r)));
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      }
      return Promise.resolve({ data: rows(), error: null }).then(res, rej);
    },
  };
  return q;
}

const fakeClient = { from: (table: string) => query(table) };

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
    ...init,
  });
}

const collection = (body: unknown, method: string) =>
  req('/api/admin/academy/pricing-formats', {
    method,
    ...(method === 'GET' ? undefined : { body: JSON.stringify(body) }),
  });

const item = (key: string, body: unknown, method: string) =>
  req(`/api/admin/academy/pricing-formats/${key}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function seededFormats(): Row[] {
  return [
    { key: 'weekend_day', label: 'Weekend (No Boarding)', note: null, sort_order: 10, is_active: true, default_price_ngn: 50000 },
    { key: 'weekend_boarding', label: 'Weekend (With Boarding)', note: null, sort_order: 20, is_active: true, default_price_ngn: 80000 },
    { key: 'weekday_day', label: 'Week days (No Boarding)', note: null, sort_order: 30, is_active: true, default_price_ngn: 100000 },
    { key: 'weekday_boarding', label: 'Week days (Boarding)', note: null, sort_order: 40, is_active: true, default_price_ngn: 150000 },
    { key: 'full_time_boarding', label: '1 month - Boarding', note: null, sort_order: 50, is_active: true, default_price_ngn: 200000 },
  ];
}

const formatWrites = () => writes.filter((w) => w.table === 'academy_pricing_formats');
const optionWrites = () => writes.filter((w) => w.table === 'academy_area_pricing_options');
const deleted = () => writes.some((w) => w.method === 'delete');
const keysOf = (rows: Row[]) => rows.map((f) => f.key);

async function jsonOf(res: Response, status: number) {
  expect(res.status).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    academy_pricing_formats: seededFormats(),
    academy_area_pricing_options: seededFormats().map((f) => ({
      area_id: 'area-acting',
      key: f.key,
      label: f.label,
      note: null,
      price_ngn: f.default_price_ngn,
      sort_order: f.sort_order,
    })),
    academy_interest_areas: [{ id: 'area-acting', slug: 'acting', is_active: true }],
    academy_applications: [],
  };
  writes = [];
  formatsListError = null;
  formatsRowError = null;
  applicationsError = null;
  areasError = null;
  optionsWriteError = null;
  vi.mocked(assertAdminPermission).mockResolvedValue({ role: 'super_admin', actorId: ADMIN_ID } as never);
  vi.mocked(createAdminClient).mockReturnValue(fakeClient as never);
});

describe('GET /api/admin/academy/pricing-formats', () => {
  it('lists withdrawn formats too, in the operator order', async () => {
    tables.academy_pricing_formats.push({
      key: 'evening_class',
      label: 'Evening Class',
      note: null,
      sort_order: 5,
      is_active: false,
      default_price_ngn: 60000,
    });
    const body = await jsonOf(await listFormats(collection({}, 'GET')), 200);
    expect(keysOf(body.formats as Row[])).toEqual([
      'evening_class',
      'weekend_day',
      'weekend_boarding',
      'weekday_day',
      'weekday_boarding',
      'full_time_boarding',
    ]);
    expect(body.degraded).toBe(false);
  });

  it('says when the answer came from the launch structure, not the table', async () => {
    formatsListError = { message: 'relation "academy_pricing_formats" does not exist', code: '42P01' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = await jsonOf(await listFormats(collection({}, 'GET')), 200);
    warnSpy.mockRestore();
    expect(body.degraded).toBe(true);
    expect(keysOf(body.formats as Row[])).toEqual(keysOf(seededFormats()));
  });

  it('403s without the permission and reads nothing', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await listFormats(collection({}, 'GET'));
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/academy/pricing-formats — add a format', () => {
  const good = { key: 'summer_intensive', label: 'Summer Intensive (2 weeks)', default_price_ngn: 120000 };

  it('creates the row last in the order and prices it for every active training', async () => {
    const body = await jsonOf(await createFormat(collection(good, 'POST')), 200);
    const created = (body.format ?? {}) as Row;
    expect(created).toMatchObject({ key: 'summer_intensive', label: 'Summer Intensive (2 weeks)', is_active: true, sort_order: 60 });
    expect(tables.academy_pricing_formats.map((f) => f.key)).toContain('summer_intensive');
    const rows = (optionWrites()[0]?.payload ?? []) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      area_id: 'area-acting',
      key: 'summer_intensive',
      label: 'Summer Intensive (2 weeks)',
      price_ngn: 120000,
      sort_order: 60,
    });
    expect(addAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'academy.pricing_format.create', entityType: 'academy_pricing_formats', entityId: 'summer_intensive' }),
    );
  });

  it('normalises the key it stores — the key is the applicant-facing identifier', async () => {
    await jsonOf(await createFormat(collection({ ...good, key: ' SUMMER_Intensive ' }, 'POST')), 200);
    expect(keysOf(tables.academy_pricing_formats)).toContain('summer_intensive');
  });

  it('refuses a key the database would reject', async () => {
    for (const key of ['', 'a', '1weekend', 'weekend-day', 'summer intensive', 'x'.repeat(41), 42, null]) {
      writes = [];
      const res = await createFormat(collection({ ...good, key }, 'POST'));
      expect(`${key}:${res.status}`).toBe(`${key}:400`);
      expect(formatWrites()).toHaveLength(0);
    }
  });

  it('refuses a key already in use with 409 and writes nothing', async () => {
    const body = await jsonOf(await createFormat(collection({ ...good, key: 'weekend_day' }, 'POST')), 409);
    expect(JSON.stringify(body)).toMatch(/already exists/i);
    expect(formatWrites()).toHaveLength(0);
    expect(optionWrites()).toHaveLength(0);
  });

  it('refuses a zero, negative, fractional, non-numeric or absurd default price', async () => {
    for (const price of [0, -50000, 120000.5, 'abc', '', '1e5', null, true, 10_000_000_000]) {
      const res = await createFormat(collection({ ...good, default_price_ngn: price }, 'POST'));
      expect(res.status).toBe(400);
    }
    expect(formatWrites()).toHaveLength(0);
  });

  it('requires a label and a sane note', async () => {
    for (const patch of [{ label: '   ' }, { label: 'x'.repeat(201) }, { note: 'x'.repeat(501) }, { sort_order: 'first' }]) {
      const res = await createFormat(collection({ ...good, ...patch }, 'POST'));
      expect(res.status).toBe(400);
      expect(formatWrites()).toHaveLength(0);
    }
  });

  it('creates the format even when the per-training seeding fails, and warns', async () => {
    optionsWriteError = { message: 'row-level lock timeout', code: '55P03' };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = await jsonOf(await createFormat(collection(good, 'POST')), 200);
    errSpy.mockRestore();
    expect(body.warning).toBeTruthy();
    expect(keysOf(tables.academy_pricing_formats)).toContain('summer_intensive');
    expect(addAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('not seeded') }),
    );
  });

  it('an unknown format key is offered where the applicant sees it: it appears in the list', async () => {
    await jsonOf(await createFormat(collection(good, 'POST')), 200);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = await jsonOf(await listFormats(collection({}, 'GET')), 200);
    warnSpy.mockRestore();
    expect(keysOf(body.formats as Row[])).toContain('summer_intensive');
  });
});

describe('PUT /api/admin/academy/pricing-formats — reorder', () => {
  const ascending = ['weekend_day', 'weekend_boarding', 'weekday_day', 'weekday_boarding', 'full_time_boarding'];

  it('writes the new positions to the catalogue and to every stored copy', async () => {
    const order = [...ascending].reverse();
    await jsonOf(await reorderFormats(collection({ order }, 'PUT')), 200);
    expect(tables.academy_pricing_formats.find((f) => f.key === 'full_time_boarding')!.sort_order).toBe(10);
    expect(tables.academy_pricing_formats.find((f) => f.key === 'weekend_day')!.sort_order).toBe(50);
    // One catalogue write + one price-row re-sync per format that MOVED. Reversed,
    // the middle format lands on its own position, so four move and it is skipped.
    expect(formatWrites().filter((w) => w.method === 'update')).toHaveLength(4);
    expect(optionWrites().filter((w) => w.method === 'update')).toHaveLength(4);
    expect((optionWrites()[0].payload as Row).sort_order).toBeDefined();
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'academy.pricing_format.reorder' }));
  });

  it('an identical order is not a change: no writes, no audit', async () => {
    await jsonOf(await reorderFormats(collection({ order: ascending }, 'PUT')), 200);
    expect(formatWrites()).toHaveLength(0);
    expect(optionWrites()).toHaveLength(0);
    expect(addAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses an order that omits, repeats or invents a format', async () => {
    const cases: unknown[] = [
      ['weekend_day'],
      ['weekend_day', 'weekend_boarding', 'weekday_day', 'weekday_boarding', 'weekend_day'],
      ['weekend_day', 'weekend_boarding', 'weekday_day', 'weekday_boarding', 'evening_class'],
      [],
      'weekend_day',
      { 0: 'weekend_day' },
    ];
    for (const order of cases) {
      const res = await reorderFormats(collection({ order }, 'PUT'));
      expect(res.status).toBe(400);
    }
    expect(formatWrites()).toHaveLength(0);
    // A withdrawn format still has to be named, or the rest silently shuffle.
    tables.academy_pricing_formats[0].is_active = false;
    const partial = ascending.slice(1);
    const res = await reorderFormats(collection({ order: partial }, 'PUT'));
    expect(res.status).toBe(400);
  });

  it('names a malformed key as malformed, not as merely unknown', async () => {
    // Both are 400, but the operator needs to be told the key is not a legal
    // identifier: academy_applications stores it forever, so "unknown" would
    // read as a typo in a list they could fix by adding it.
    const body = await jsonOf(await reorderFormats(collection({ order: ['Bad Key!'] }, 'PUT')), 400);
    expect(JSON.stringify(body)).toMatch(/2-40 characters/i);
  });
});

describe('PUT /api/admin/academy/pricing-formats/[key] — edit one format', () => {
  it('renames it and re-syncs the wording stored on the trainings', async () => {
    await jsonOf(await updateFormat(item('weekend_day', { label: '  Saturday Intensive  ' }, 'PUT')), 200);
    expect(tables.academy_pricing_formats.find((f) => f.key === 'weekend_day')!.label).toBe('Saturday Intensive');
    const sync = optionWrites().find((w) => w.method === 'update');
    expect(sync).toBeDefined();
    expect((sync!.payload as Row).label).toBe('Saturday Intensive');
    expect(addAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'academy.pricing_format.update', entityId: 'weekend_day' }),
    );
  });

  it('refuses to change the key — applications store it', async () => {
    const body = await jsonOf(await updateFormat(item('weekend_day', { key: 'saturday', label: 'X' }, 'PUT')), 409);
    expect(JSON.stringify(body)).toMatch(/cannot be changed/i);
    expect(formatWrites()).toHaveLength(0);
  });

  it('the same key in the body is not a rename attempt', async () => {
    await jsonOf(await updateFormat(item('weekend_day', { key: 'weekend_day', label: 'Saturday' }, 'PUT')), 200);
    expect(tables.academy_pricing_formats.find((f) => f.key === 'weekend_day')!.label).toBe('Saturday');
  });

  it('refuses to withdraw the last format on offer', async () => {
    tables.academy_pricing_formats = tables.academy_pricing_formats.map((f) => ({
      ...f,
      is_active: f.key === 'weekend_day',
    }));
    const body = await jsonOf(await updateFormat(item('weekend_day', { is_active: false }, 'PUT')), 409);
    expect(JSON.stringify(body)).toMatch(/only tuition format/i);
    expect(formatWrites()).toHaveLength(0);
    expect(addAuditEvent).not.toHaveBeenCalled();
  });

  it('withdrawing a format does NOT rewrite the stored price copies', async () => {
    await jsonOf(await updateFormat(item('weekend_boarding', { is_active: false }, 'PUT')), 200);
    expect(tables.academy_pricing_formats.find((f) => f.key === 'weekend_boarding')!.is_active).toBe(false);
    expect(optionWrites()).toHaveLength(0);
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'academy.pricing_format.retire' }));
  });

  it('edits the default price without touching history', async () => {
    await jsonOf(await updateFormat(item('weekday_day', { default_price_ngn: 110000 }, 'PUT')), 200);
    expect(tables.academy_pricing_formats.find((f) => f.key === 'weekday_day')!.default_price_ngn).toBe(110000);
    expect(optionWrites()).toHaveLength(0);
  });

  it('rejects a bad label, note or price before writing', async () => {
    for (const patch of [{ label: '' }, { label: 'x'.repeat(201) }, { default_price_ngn: 0 }, { default_price_ngn: 1.5 }, { default_price_ngn: '1e5' }, { note: 'x'.repeat(501) }]) {
      writes = [];
      const res = await updateFormat(item('weekday_day', patch, 'PUT'));
      expect(`${JSON.stringify(patch)}:${res.status}`).toBe(`${JSON.stringify(patch)}:400`);
      expect(formatWrites()).toHaveLength(0);
    }
    const empty = await jsonOf(await updateFormat(item('weekday_day', {}, 'PUT')), 400);
    expect(JSON.stringify(empty)).toMatch(/Nothing to change/i);
  });

  it('404s for a format that does not exist', async () => {
    await jsonOf(await updateFormat(item('evening_class', { label: 'X' }, 'PUT')), 404);
    expect(formatWrites()).toHaveLength(0);
  });

  it('normalises the path key rather than treating case as a different format', async () => {
    await jsonOf(await updateFormat(item('WEEKEND_DAY', { label: 'Saturday' }, 'PUT')), 200);
    expect(tables.academy_pricing_formats.find((f) => f.key === 'weekend_day')!.label).toBe('Saturday');
  });

  it('rejects a malformed key in the path before touching the database', async () => {
    for (const key of ['weekend-day', 'a'.repeat(41), "'; drop table x; --"]) {
      const res = await updateFormat(item(key, { label: 'X' }, 'PUT'));
      expect(res.status).toBe(400);
    }
    expect(formatWrites()).toHaveLength(0);
  });

  it('fails closed when the catalogue cannot be read — unchecked is not absent', async () => {
    formatsRowError = { message: 'could not read the format', code: 'XX000' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await jsonOf(await updateFormat(item('weekend_day', { label: 'X' }, 'PUT')), 500);
    warnSpy.mockRestore();
    expect(formatWrites()).toHaveLength(0);
    expect(addAuditEvent).not.toHaveBeenCalled();
  });

  it('a no-op edit writes nothing and audits nothing', async () => {
    const body = await jsonOf(await updateFormat(item('weekend_day', { label: 'Weekend (No Boarding)' }, 'PUT')), 200);
    expect(body.format).toBeTruthy();
    expect(formatWrites()).toHaveLength(0);
    expect(optionWrites()).toHaveLength(0);
    expect(addAuditEvent).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/academy/pricing-formats/[key]', () => {
  it('deletes a format no application was priced in and no training carries', async () => {
    tables.academy_area_pricing_options = [];
    await jsonOf(await deleteFormat(item('weekend_boarding', undefined, 'DELETE')), 200);
    expect(keysOf(tables.academy_pricing_formats)).not.toContain('weekend_boarding');
    expect(deleted()).toBe(true);
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'academy.pricing_format.delete' }));
  });

  it('refuses while an application was priced in it, and deletes nothing', async () => {
    tables.academy_applications = [{ id: 'app-1', pricing_option_key: 'weekend_boarding' }];
    const body = await jsonOf(await deleteFormat(item('weekend_boarding', undefined, 'DELETE')), 409);
    expect(JSON.stringify(body)).toMatch(/Withdraw it instead/i);
    expect(deleted()).toBe(false);
    expect(keysOf(tables.academy_pricing_formats)).toContain('weekend_boarding');
  });

  it('refuses while a training still carries a price for it', async () => {
    const body = await jsonOf(await deleteFormat(item('weekend_day', undefined, 'DELETE')), 409);
    expect(JSON.stringify(body)).toMatch(/carry a price/i);
    expect(deleted()).toBe(false);
  });

  it('refuses the application check itself: unchecked history is a 500, not a delete', async () => {
    applicationsError = { message: 'permission denied for table academy_applications', code: '42501' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = await jsonOf(await deleteFormat(item('weekend_boarding', undefined, 'DELETE')), 500);
    warnSpy.mockRestore();
    expect(JSON.stringify(body)).toMatch(/nothing was deleted/i);
    expect(deleted()).toBe(false);
  });

  it('404s for an unknown key and 400s for a malformed one', async () => {
    await jsonOf(await deleteFormat(item('evening_class', undefined, 'DELETE')), 404);
    expect(deleted()).toBe(false);
    for (const key of ['weekend-day', 'weekend day', '']) {
      const res = await deleteFormat(item(key, undefined, 'DELETE'));
      expect(res.status).toBe(400);
    }
  });
});

describe('the history read that gates a delete', () => {
  // countApplicationsUsingFormat interpolates the key and one training slug per
  // condition into a PostgREST OR filter, so an unvalidated key must never reach
  // it — refusing is the whole point of the guard, and it must refuse WITHOUT a
  // query (an attacker-controlled key must not be sent to the database at all).
  it('refuses a malformed key without querying', async () => {
    for (const key of ['weekend-day', 'x" OR ("1"."id"."eq"."x")', "'; drop table x; --", 'UPPER_CASE']) {
      expect(await countApplicationsUsingFormat(key)).toBeNull();
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('answers null when the trainings cannot be read, not a clean zero', async () => {
    // The areas read supplies the slugs. Treat "I could not look" as "unknown"
    // and the delete route refuses; treat it as zero and it deletes a format
    // that applications still reference.
    areasError = { message: 'permission denied for table academy_interest_areas', code: '42501' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await countApplicationsUsingFormat('weekend_day')).toBeNull();
    warnSpy.mockRestore();
    expect(deleted()).toBe(false);
    expect(writes).toHaveLength(0);
  });
});
