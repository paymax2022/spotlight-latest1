// GET /api/registration/lgas?state=<state> — the middle tier of the cascade.
//
// WHY THIS EXISTS AT ALL. The 774 local governments are static reference data and
// live in frontend-web (`NIGERIA_LGAS_BY_STATE`). The admin console is a separate
// Next app with its own bundle, so giving it the same picker by copying that table
// would put a third copy in the repo (the mobile app already carries one) and every
// LGA split would have to be applied twice. One endpoint, one owner.
//
// WHAT IS PINNED, and the one decision worth stating:
//
//   * an unknown or misspelled state answers 200 with `mode: 'free_text'` and an
//     empty list — NOT 404. The villages endpoint already behaves this way, and the
//     reason is the same: locality is display + filter, so a gap in the reference
//     data degrades the control to a text box instead of blocking the person who
//     knows the name and the server does not;
//   * a missing `state` is a 400 and names the parameter, because that is a caller
//     bug rather than a data gap;
//   * the list comes from the same table the wizard's dropdown reads, so the two
//     surfaces cannot drift into offering different LGAs for one state.
import { describe, expect, it } from 'vitest';

import { GET } from '@/app/api/registration/lgas/route';
import { readLgas } from '@/src/server/registration-v2/locality';

function get(query: string) {
  return GET(new Request(`https://x.test/api/registration/lgas${query}`));
}

describe('GET /api/registration/lgas', () => {
  it('answers the LGAs of a state, alphabetically, as curated', async () => {
    const res = await get('?state=Anambra');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('curated');
    expect(body.state).toBe('Anambra');
    expect(body.lgas).toContain('Onitsha North');
    expect(body.lgas).toContain('Onitsha South');
    expect([...body.lgas].sort()).toEqual(body.lgas);
  });

  it('trims and collapses whitespace in the query value', async () => {
    const res = await get('?state=%20Anambra%20%0A');
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe('Anambra');
  });

  it('falls open for a state the table does not know: 200, free_text, empty list', async () => {
    const res = await get('?state=Atlantis');
    expect(res.status).toBe(200);
    const body = await res.json();
    // [] not null: the caller maps over it.
    expect(body.lgas).toEqual([]);
    expect(body.mode).toBe('free_text');
  });

  it('matches a state whatever case it arrives in', async () => {
    // The wizard sends the label it displays; a query built by hand, a mail merge,
    // or an admin console that lowercases before fetching must not turn a known
    // state into a free-text box.
    const res = await get('?state=anambra');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('curated');
    // Canonical spelling back, so a caller that filters contestants by state
    // filters on the same string the reference table uses.
    expect(body.state).toBe('Anambra');
    expect(body.lgas).toContain('Onitsha North');
  });

  it('refuses a call with no state and says which parameter is missing', async () => {
    const res = await get('');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('state');
  });

  it('refuses an absurdly long state before it reaches the table', async () => {
    const res = await get(`?state=${'A'.repeat(300)}`);
    expect(res.status).toBe(400);
  });
});

describe('readLgas', () => {
  it('is usable without an HTTP layer, for a caller that already parsed the query', () => {
    const got = readLgas('Lagos');
    if (!got.ok) throw new Error(`unexpected: ${got.error}`);
    expect(got.payload.lgas.length).toBeGreaterThan(0);
    expect(got.payload.mode).toBe('curated');
  });
});
