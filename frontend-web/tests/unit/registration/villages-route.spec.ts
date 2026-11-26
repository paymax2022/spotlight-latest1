// GET /api/registration/villages?state=&lga= — the village tier of the
// state -> LGA -> village cascade, for the web wizard.
//
// Why a route at all: the Onitsha North quarters are curated content an admin
// edits (public.villages, migration 20272000000000). Bundling them in the app
// would make "add a village" a redeploy, so the picker reads the table. The
// phone reads the same rows through Go's /api/v1/connect/villages; this is the
// BFF door for the web form, which is the shape every other registration
// screen already uses.
//
// The cases below are the ones an applicant actually hits: a curated LGA, an LGA
// nobody has published yet (must stay USABLE, not 404), a half-supplied pair, and
// the database being unreachable. The active-row filter and the alphabetical
// order are asserted on the query the route builds because a retired village
// showing up in a public picker is a data-visible bug that no response shape
// would reveal.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET } from '@/app/api/registration/villages/route';
import { createAdminClient } from '@/lib/supabase/server';

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function mockQuery(result: { data?: Array<{ name: string }>; error?: { message: string } }) {
  const calls: string[] = [];
  const chain: Chain = {
    from: vi.fn((table: string) => {
      calls.push(`from:${table}`);
      return chain;
    }),
    select: vi.fn((cols: string) => {
      calls.push(`select:${cols}`);
      return chain;
    }),
    eq: vi.fn((key: string, value: unknown) => {
      calls.push(`eq:${key}=${value}`);
      return chain;
    }),
    order: vi.fn((key: string, opts?: { ascending?: boolean }) => {
      calls.push(`order:${key}:${opts?.ascending}`);
      return Promise.resolve(result);
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue(chain as never);
  return calls;
}

function get(query: string) {
  return GET(new Request(`https://x.test/api/registration/villages${query}`));
}

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset();
});

describe('GET /api/registration/villages', () => {
  it('returns the curated villages for an LGA, in the order the query asked for', async () => {
    const calls = mockQuery({ data: [{ name: 'Isiokwe' }, { name: 'Ogbendida' }] });

    const res = await get('?state=Anambra&lga=Onitsha%20North');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe('curated');
    expect(body.state).toBe('Anambra');
    expect(body.lga).toBe('Onitsha North');
    expect(body.villages).toEqual(['Isiokwe', 'Ogbendida']);

    expect(calls).toContain('from:villages');
    expect(calls).toContain('eq:state=Anambra');
    expect(calls).toContain('eq:lga=Onitsha North');
    expect(calls).toContain('eq:is_active=true');
    expect(calls).toContain('order:name:true');
  });

  it('answers 200 + free_text for an LGA with no published villages', async () => {
    mockQuery({ data: [] });

    const res = await get('?state=Anambra&lga=Onitsha%20South');
    expect(res.status).toBe(200);

    const body = await res.json();
    // Not a 404: the wizard turns this into a text input so the applicant can
    // still name their quarter.
    expect(body.mode).toBe('free_text');
    expect(body.villages).toEqual([]);
  });

  it('refuses a half-supplied pair and names the missing field', async () => {
    const calls = mockQuery({ data: [] });

    for (const query of ['?state=Anambra', '?lga=Onitsha%20North', '']) {
      const res = await get(query);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/state|lga/);
    }
    // Validated before the database, so a bad query never costs a round trip.
    expect(calls).toEqual([]);
  });

  it('trims padded query values instead of querying for them', async () => {
    const calls = mockQuery({ data: [] });

    await get('?state=%20Anambra%0A&lga=Onitsha%20North%20');
    expect(calls).toContain('eq:state=Anambra');
    expect(calls).toContain('eq:lga=Onitsha North');
  });

  it('says the list is unavailable, without repeating the database error', async () => {
    mockQuery({ error: { message: 'relation "villages" does not exist' } });

    const res = await get('?state=Anambra&lga=Onitsha%20North');
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('village list unavailable.');
    expect(JSON.stringify(body)).not.toContain('relation');
  });
});
