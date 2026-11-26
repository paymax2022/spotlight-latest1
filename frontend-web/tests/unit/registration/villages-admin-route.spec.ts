/**
 * Admin CRUD for the curated village list — the module that makes the village tier
 * maintainable instead of frozen.
 *
 * WHY A ROUTE AT ALL. The 15 Onitsha North quarters arrived as a migration seed, which
 * means every other LGA stays a text box until a human adds rows — and "a human adds a
 * row" currently means a migration and a deploy. The picker's contract is "an LGA with
 * rows is curated, an LGA without them is free text", so the only way to widen the
 * curated set is to let admins publish into `public.villages`.
 *
 * The tests pin what makes a reference table safe to open to writes:
 *  - the feature flag. 'Feature-flag every new module. No flag, no merge' (CLAUDE.md), so
 *    the surface is dark until an environment opts in, and — following the BFF's existing
 *    order — the flag answers before the auth check, which is why an unauthenticated
 *    request to a dark module sees 503 rather than 401/403. Gating is on the WRITE module
 *    only: with the flag off, the applicant-facing pickers keep working against whatever
 *    is already curated, so an admin feature can never become a user-facing outage;
 *  - RBAC: 'programs:manage', the guard the contest and category routes already use, since
 *    a curated list decides what thousands of applicants see;
 *  - the boundary checks that mirror the DDL (btrim length > 1, the 80-char cap the picker
 *    and Go share, the (state, lga, name) uniqueness reported as a conflict);
 *  - per-name answers for a pasted list: publishing 14 of 15 quarters and silently losing
 *    the 15th is the difference between a usable table and a support ticket;
 *  - retired rows staying visible to the admin who retired them, because `is_active=false`
 *    is meant to be reversible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET, POST } from '@/app/api/admin/villages/route';
import { PATCH, DELETE } from '@/app/api/admin/villages/[id]/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

const FLAG = 'FEATURE_LOCALITY_VILLAGES_ENABLED';
const UNIQUE_ERROR = {
  message: 'duplicate key value violates unique constraint "villages_state_lga_name_key"',
  code: '23505',
};

function req(method: string, body?: unknown, url = 'https://x.test/api/admin/villages') {
  return new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

interface StubCalls {
  insert: unknown[];
  filters: string[];
  writes: { id: string; payload?: unknown }[];
  deletes: { id: string }[];
}

/**
 * One chainable stub, because the Supabase client is a query builder: filters arrive as
 * .eq() calls AFTER the write is chosen, so a write's id is filled in when .eq('id') runs
 * rather than when .update() is called.
 *
 * `order` returns the chain itself with the resolved rows attached, which is what the real
 * PostgREST builder does — it is a thenable, so a query can sort by more than one column
 * (`order('lga').order('name')`) and still be awaitable at the end.
 */
function stub(opts: { list?: unknown[]; row?: unknown; error?: { message: string; code?: string } } = {}): StubCalls {
  const calls: StubCalls = { insert: [], filters: [], writes: [], deletes: [] };
  let open: { id: string; payload?: unknown } | null = null;
  const settled = () => Promise.resolve({ data: opts.list ?? [], error: null });
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (key: string, value: unknown) => {
      calls.filters.push(`${key}=${String(value)}`);
      if (key === 'id' && open) open.id = String(value);
      return chain;
    },
    neq: (key: string, value: unknown) => {
      calls.filters.push(`${key}!=${String(value)}`);
      return chain;
    },
    order: () => Object.assign(settled(), chain),
    maybeSingle: () => Promise.resolve({ data: opts.row ?? null, error: null }),
    insert: (payload: unknown) => {
      calls.insert.push(payload);
      return chain;
    },
    update: (payload: unknown) => {
      open = { id: '', payload };
      calls.writes.push(open);
      return chain;
    },
    delete: () => {
      open = { id: '' };
      calls.deletes.push(open);
      return chain;
    },
    single: () => Promise.resolve({ data: opts.row ?? null, error: opts.error ?? null }),
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: () => chain } as never);
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env[FLAG] = 'true';
  vi.mocked(assertAdminPermission).mockResolvedValue({ id: 'admin-1' } as never);
});

afterEach(() => {
  delete process.env[FLAG];
});

describe('POST /api/admin/villages', () => {
  it('is dark until the module flag is on', async () => {
    delete process.env[FLAG];
    const calls = stub();
    const res = await POST(req('POST', { state: 'Anambra', lga: 'Onitsha North', name: 'Ogbendida' }));
    expect(res.status).toBe(503);
    // Dark means refused before anything was decided or written, not "wrote it and then
    // complained" — and before the auth probe, which is the order the BFF already uses.
    expect(calls.insert).toEqual([]);
    expect(vi.mocked(assertAdminPermission)).not.toHaveBeenCalled();
  });

  it('needs an admin, and says which permission', async () => {
    // The real gate throws ApiError('Forbidden', 403), so the mock throws that shape and
    // handleApiError's passthrough is what the route's 403 comes from.
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(assertAdminPermission).mockRejectedValue(new ApiError('Forbidden', 403));
    stub();
    const res = await POST(req('POST', { state: 'Anambra', lga: 'Onitsha North', name: 'Ogbendida' }));
    expect(res.status).toBe(403);
    expect(vi.mocked(assertAdminPermission)).toHaveBeenCalledWith(expect.anything(), 'programs:manage');
  });

  it('writes the snake_case row the table expects, trimmed', async () => {
    const calls = stub({ row: { id: 'v1', state: 'Anambra', lga: 'Onitsha North', name: 'Ogbendida' } });
    const res = await POST(req('POST', { state: ' Anambra ', lga: 'Onitsha North', name: ' Ogbendida ' }));
    expect(res.status).toBe(201);
    expect(calls.insert).toEqual([{ state: 'Anambra', lga: 'Onitsha North', name: 'Ogbendida', notes: '' }]);
  });

  it('names the field that is missing instead of a generic bad request', async () => {
    stub();
    const noLga = await POST(req('POST', { state: 'Anambra', name: 'Ogbendida' }));
    expect(noLga.status).toBe(400);
    expect((await noLga.json()).error).toMatch(/lga/i);

    const noName = await POST(req('POST', { state: 'Anambra', lga: 'Onitsha North' }));
    expect((await noName.json()).error).toMatch(/name/i);
  });

  // CHECK (char_length(btrim(name)) > 1) in the DDL: a one-character "village" is a
  // keystroke, so the route refuses it instead of letting Postgres reject the write.
  it('refuses a one-character name, the same floor the column enforces', async () => {
    stub();
    const res = await POST(req('POST', { state: 'Anambra', lga: 'Onitsha North', name: 'x' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it('refuses a name longer than the 80-char ceiling the pickers share', async () => {
    stub();
    expect((await POST(req('POST', { state: 'Anambra', lga: 'Onitsha North', name: 'a'.repeat(81) }))).status).toBe(400);
  });

  it('accepts a village under an LGA nobody has curated yet', async () => {
    // The table IS the curation: there is no foreign key to a curated LGA list, and adding
    // the FIRST quarter of an LGA is the normal case, not an error.
    stub({ row: { id: 'v1', state: 'Enugu', lga: 'Nkanu East', name: 'Anyi' } });
    expect((await POST(req('POST', { state: 'Enugu', lga: 'Nkanu East', name: 'Anyi' }))).status).toBe(201);
  });

  it('publishes a pasted list and reports each name it could not store', async () => {
    const calls = stub();
    const res = await POST(req('POST', {
      state: 'Anambra',
      lga: 'Onitsha North',
      names: ['Isiokwe', 'Mgbelekeke', 'Ogbendida', '  ', 'a'.repeat(90)],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created.map((v: { name: string }) => v.name)).toEqual(['Isiokwe', 'Mgbelekeke', 'Ogbendida']);
    expect(body.skipped).toHaveLength(2);
    expect(body.skipped[0]).toMatchObject({ name: '', reason: expect.stringMatching(/name/i) });
    expect(calls.insert).toHaveLength(3);
  });

  it('calls an existing quarter a conflict, not a server error', async () => {
    stub({ error: UNIQUE_ERROR });
    const res = await POST(req('POST', { state: 'Anambra', lga: 'Onitsha North', name: 'Ogbendida' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already/i);
  });

  it('does not let a driver failure look like a validation mistake', async () => {
    stub({ error: { message: 'permission denied for table villages', code: '42501' } });
    const res = await POST(req('POST', { state: 'Anambra', lga: 'Onitsha North', name: 'Ogbendida' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/permission denied/i);
  });
});

describe('GET /api/admin/villages', () => {
  it('lists the rows, filtered by the pair being curated', async () => {
    const calls = stub({ list: [{ id: 'v1', state: 'Anambra', lga: 'Onitsha North', name: 'Ogbeotu', is_active: true }] });
    const res = await GET(req('GET', undefined, 'https://x.test/api/admin/villages?state=Anambra&lga=Onitsha+North'));
    expect(res.status).toBe(200);
    expect((await res.json()).villages).toHaveLength(1);
    expect(calls.filters).toContain('state=Anambra');
    expect(calls.filters).toContain('lga=Onitsha North');
  });

  // is_active=false is meant to be reversible, so the console has to be able to see the
  // retired rows: the picker's filter belongs to /api/registration/villages, not here.
  it('shows retired rows unless the caller asks for the active ones', async () => {
    const calls = stub({ list: [{ id: 'v1', name: 'Ogbeotu', is_active: false }] });
    await GET(req('GET', undefined, 'https://x.test/api/admin/villages?state=Anambra'));
    expect(calls.filters.some((f) => f.startsWith('is_active'))).toBe(false);

    // A fresh stub: stub() rebinds createAdminClient, so the second request's filters are
    // recorded on its own calls object, not the one above.
    const filtered = stub();
    await GET(req('GET', undefined, 'https://x.test/api/admin/villages?state=Anambra&active=true'));
    expect(filtered.filters).toContain('is_active=true');
  });

  it('is dark without the flag, so the module switches off as a whole', async () => {
    delete process.env[FLAG];
    stub();
    expect((await GET(req('GET', undefined, 'https://x.test/api/admin/villages?state=Anambra'))).status).toBe(503);
  });
});

describe('PATCH and DELETE /api/admin/villages/[id]', () => {
  it('renames and retires through one patch', async () => {
    const calls = stub({ row: { id: 'v1', state: 'Anambra', lga: 'Onitsha North', name: 'Umudei', is_active: true } });
    const res = await PATCH(req('PATCH', { name: 'Umudei Iku', active: false }, 'https://x.test/api/admin/villages/v1'), ctx('v1'));
    expect(res.status).toBe(200);
    expect(calls.writes[0]).toEqual({ id: 'v1', payload: { name: 'Umudei Iku', is_active: false } });
  });

  it('refuses a patch that would empty the name', async () => {
    const calls = stub({ row: { id: 'v1', state: 'Anambra', lga: 'Onitsha North', name: 'Umudei', is_active: true } });
    const res = await PATCH(req('PATCH', { name: '   ' }, 'https://x.test/api/admin/villages/v1'), ctx('v1'));
    expect(res.status).toBe(400);
    expect(calls.writes).toEqual([]);
  });

  it('says 404 for a row that is not there instead of writing blindly', async () => {
    const calls = stub({ row: null });
    const res = await PATCH(req('PATCH', { name: 'Ghost' }, 'https://x.test/api/admin/villages/nope'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(calls.writes).toEqual([]);
  });

  it('deletes by id', async () => {
    const calls = stub({ row: { id: 'v9', state: 'Anambra', lga: 'Onitsha North', name: 'Typo', is_active: true } });
    const res = await DELETE(req('DELETE', undefined, 'https://x.test/api/admin/villages/v9'), ctx('v9'));
    expect(res.status).toBe(200);
    expect(calls.deletes).toEqual([{ id: 'v9' }]);
  });

  it('is dark without the flag on the per-row routes too', async () => {
    delete process.env[FLAG];
    stub({ row: { id: 'v1', name: 'Umudei' } });
    const patch = await PATCH(req('PATCH', { name: 'x' }, 'https://x.test/api/admin/villages/v1'), ctx('v1'));
    expect(patch.status).toBe(503);
    expect((await DELETE(req('DELETE', undefined, 'https://x.test/api/admin/villages/v1'), ctx('v1'))).status).toBe(503);
  });
});
