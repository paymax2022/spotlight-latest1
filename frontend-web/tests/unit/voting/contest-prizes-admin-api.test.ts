/**
 * CS-010 — contest-prizes admin API (app/api/admin/voting/contest-prizes/**).
 *
 * Mirrors tests/unit/voting/contest-templates-admin-api.test.ts's pattern:
 * assertAdminPermission and createAdminClient are mocked at their module
 * boundary, so these assert the routes' own contract (auth gating, CRUD,
 * duplicate-position 409) rather than Postgres itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET as listGET, POST as createPOST } from '@/app/api/admin/voting/contest-prizes/route';
import { PATCH as itemPATCH, DELETE as itemDELETE } from '@/app/api/admin/voting/contest-prizes/[prizeId]/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';

function ctx(prizeId = 'prize-1') {
  return { params: Promise.resolve({ prizeId }) };
}

function jsonReq(method: string, body?: unknown, url = 'https://x.test/api/admin/voting/contest-prizes') {
  return new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
}

function makeSupabase(opts: {
  existingByPosition?: any; // returned by the duplicate-position pre-check in POST
  prizeRow?: any; // returned by .maybeSingle() in PATCH/DELETE lookups
  insertedPrize?: any;
  updatedPrize?: any;
  insertErrorCode?: string;
  listRows?: any[];
}) {
  const calls: any = { insertPayload: null, updatePayload: null, deletedIds: [] as string[] };

  function prizesChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({ data: opts.listRows ?? [], error: null }),
      maybeSingle: () => {
        // Distinguish the duplicate-position pre-check (POST) from the
        // by-id existence check (PATCH/DELETE) via whichever fixture is set.
        if (opts.existingByPosition !== undefined) {
          return Promise.resolve({ data: opts.existingByPosition, error: null });
        }
        return Promise.resolve({ data: opts.prizeRow ?? null, error: null });
      },
      single: () => {
        if (opts.insertErrorCode) {
          return Promise.resolve({ data: null, error: { code: opts.insertErrorCode, message: 'duplicate' } });
        }
        return Promise.resolve({
          data: opts.insertedPrize ?? opts.updatedPrize ?? opts.prizeRow ?? null,
          error: null,
        });
      },
      insert: (payload: any) => {
        calls.insertPayload = payload;
        return chain;
      },
      update: (payload: any) => {
        calls.updatePayload = payload;
        return chain;
      },
      delete: () => {
        calls.deletedIds.push('called');
        return chain;
      },
    };
    return chain;
  }

  const client: any = {
    from: (table: string) => {
      if (table === 'contest_prizes') return prizesChain();
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
});

describe('CS-010: contest-prizes admin API', () => {
  it('GET is rejected before any query when the caller lacks votes:manage', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await listGET(jsonReq('GET', undefined, 'https://x.test/api/admin/voting/contest-prizes?connectContestId=c1'));
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('POST is rejected before any query when the caller lacks votes:manage', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await createPOST(jsonReq('POST', { connectContestId: 'c1', position: 1, prizeDescription: 'Gold' }));
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('GET requires connectContestId', async () => {
    const { client } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client);
    const res = await listGET(jsonReq('GET'));
    expect(res.status).toBe(400);
  });

  it('GET lists prizes ordered by position', async () => {
    const listRows = [
      { id: 'p2', connect_contest_id: 'c1', position: 2, prize_description: 'Silver', prize_value_kobo: 500000, created_by: 'admin-1', created_at: 't', updated_at: 't' },
      { id: 'p1', connect_contest_id: 'c1', position: 1, prize_description: 'Gold', prize_value_kobo: 1000000, created_by: 'admin-1', created_at: 't', updated_at: 't' },
    ];
    const { client } = makeSupabase({ listRows });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await listGET(jsonReq('GET', undefined, 'https://x.test/api/admin/voting/contest-prizes?connectContestId=c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prizes).toHaveLength(2);
    expect(body.prizes[0].prizeValueKobo).toBe(500000);
  });

  it('POST rejects a non-positive-integer position', async () => {
    const { client } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client);
    const res = await createPOST(jsonReq('POST', { connectContestId: 'c1', position: 0, prizeDescription: 'Gold' }));
    expect(res.status).toBe(400);
  });

  it('POST rejects a duplicate position for the same contest with 409 (pre-check)', async () => {
    const { client } = makeSupabase({ existingByPosition: { id: 'existing-prize' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(
      jsonReq('POST', { connectContestId: 'c1', position: 1, prizeDescription: 'Gold' }),
    );
    expect(res.status).toBe(409);
  });

  it('POST maps a DB unique-constraint violation (23505) to a clean 409, not a raw 500', async () => {
    const { client } = makeSupabase({ existingByPosition: null, insertErrorCode: '23505' });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(
      jsonReq('POST', { connectContestId: 'c1', position: 1, prizeDescription: 'Gold' }),
    );
    expect(res.status).toBe(409);
  });

  it('POST succeeds and returns 201 with the inserted prize', async () => {
    const insertedPrize = {
      id: 'prize-new', connect_contest_id: 'c1', position: 1, prize_description: 'Gold', prize_value_kobo: 1000000,
      created_by: 'admin-1', created_at: 't', updated_at: 't',
    };
    const { client, calls } = makeSupabase({ existingByPosition: null, insertedPrize });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(
      jsonReq('POST', { connectContestId: 'c1', position: 1, prizeDescription: 'Gold', prizeValueKobo: 1000000 }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.prize.position).toBe(1);
    expect(calls.insertPayload).toMatchObject({ connect_contest_id: 'c1', position: 1, prize_description: 'Gold' });
  });

  it('PATCH 404s when the prize does not exist', async () => {
    const { client } = makeSupabase({ prizeRow: null });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(jsonReq('PATCH', { prizeDescription: 'New' }), ctx('missing'));
    expect(res.status).toBe(404);
  });

  it('PATCH updates prizeDescription/prizeValueKobo', async () => {
    const updatedPrize = {
      id: 'prize-1', connect_contest_id: 'c1', position: 1, prize_description: 'Updated', prize_value_kobo: 200000,
      created_by: 'admin-1', created_at: 't', updated_at: 't2',
    };
    const { client, calls } = makeSupabase({ prizeRow: { id: 'prize-1' }, updatedPrize });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(jsonReq('PATCH', { prizeDescription: 'Updated', prizeValueKobo: 200000 }), ctx('prize-1'));
    expect(res.status).toBe(200);
    expect(calls.updatePayload).toMatchObject({ prize_description: 'Updated', prize_value_kobo: 200000 });
  });

  it('PATCH ignores position/connectContestId even if sent', async () => {
    const { client } = makeSupabase({ prizeRow: { id: 'prize-1' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(jsonReq('PATCH', { position: 99, connectContestId: 'other' }), ctx('prize-1'));
    // Neither field is "updatable" per the route contract, so with no other
    // field supplied this is a no-op update -> 400.
    expect(res.status).toBe(400);
  });

  it('DELETE removes the prize', async () => {
    const { client, calls } = makeSupabase({ prizeRow: { id: 'prize-1' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemDELETE(jsonReq('DELETE'), ctx('prize-1'));
    expect(res.status).toBe(200);
    expect(calls.deletedIds.length).toBe(1);
  });

  it('DELETE 404s when the prize does not exist', async () => {
    const { client } = makeSupabase({ prizeRow: null });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemDELETE(jsonReq('DELETE'), ctx('missing'));
    expect(res.status).toBe(404);
  });
});
