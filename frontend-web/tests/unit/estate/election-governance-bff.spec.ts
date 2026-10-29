/**
 * Estate election governance on the BFF (Phase 2.2, EST-UAT-0205/0213/0216/0219/0221/0228).
 *
 * Pins the three route-level invariants the governance build depends on:
 *  - the ballot receipt reads participation as a LIST, because a one_vote_per_unit
 *    election legitimately has several rows per voter (a maybeSingle() there answered
 *    the receipt screen with an error for every weighted voter);
 *  - casting goes through estate_cast_vote with the unit and the abstention it is
 *    given, and maps the state codes that function raises to the reason the voter
 *    was refused;
 *  - publishing results is a governance act delegated to the Go service, never a
 *    local write of status='tallied'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } }),
  },
}));

vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/lib/go-backend', () => ({ proxyToGoBackend: vi.fn() }));
vi.mock('@/src/server/elections/elections.service', () => ({
  getResidentContext: vi.fn(),
  checkVoteEligibility: vi.fn(),
  getVoterUnits: vi.fn(),
  isWithinWindow: vi.fn(() => true),
  mapElection: vi.fn(() => ({ id: 'mapped' })),
  MAIN_POSITION_SUFFIX: ':main',
  SEALED_BALLOT: 'sealed',
  ELECTION_SELECT: 'id, estate_id, title, description, starts_at, ends_at, status',
}));

import { GET as getBallot } from '../../../app/api/v1/elections/[id]/ballot/route';
import { POST as castVote } from '../../../app/api/v1/elections/[id]/vote/route';
import { POST as publishResults } from '../../../app/api/v1/elections/[id]/publish/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import {
  checkVoteEligibility,
  getResidentContext,
  getVoterUnits,
} from '@/src/server/elections/elections.service';

const ELECTION = '11111111-1111-4111-8111-111111111111';
const CANDIDATE = '22222222-2222-4222-8222-222222222222';
const UNIT_A = '33333333-3333-4333-8333-333333333333';
const UNIT_B = '44444444-4444-4444-8444-444444444444';
const FOREIGN_UNIT = '55555555-5555-4555-8555-555555555555';
const ESTATE = '66666666-6666-4666-8666-666666666666';
const VOTER = 'user-1';

interface Script {
  election?: any;
  participation?: any[];
  candidate?: any;
  rpcError?: any;
  updated?: any;
}

// Table-aware thenable mock: the routes await either a row (maybeSingle/single) or a
// list, so the chain answers both.
function makeClient(script: Script) {
  const writes: any[] = [];
  const st: any = { table: '', filters: [], cols: '', op: 'select' };
  const chain: any = {
    select(cols: string) { st.cols = cols; return chain; },
    eq(_c: string, _v: any) { return chain; },
    or() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    update(payload: any) { st.op = 'update'; writes.push({ table: st.table, payload }); return chain; },
    maybeSingle: async () =>
      st.table === 'elections'
        ? { data: script.election ?? null, error: null }
        : st.table === 'election_candidates'
          ? { data: script.candidate ?? null, error: null }
          : { data: null, error: null },
    single: async () => ({ data: script.updated ?? script.election ?? null, error: null }),
    then(resolve: any) {
      if (st.table === 'election_votes') return resolve({ data: script.participation ?? [], error: null });
      return resolve({ data: [], error: null });
    },
  };
  return {
    client: {
      from(table: string) { st.table = table; st.op = 'select'; return chain; },
      rpc: vi.fn(async () => ({ data: null, error: script.rpcError ?? null })),
    },
    writes,
  };
}

function req(url: string, init?: RequestInit) {
  return new Request(url, { ...init, headers: { authorization: 'Bearer t', ...(init?.headers ?? {}) } });
}

function post(url: string, body: unknown) {
  return req(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const openElection = { id: ELECTION, estate_id: ESTATE, weighting: 'one_person_one_vote', status: 'open', starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' };
const weightedElection = { ...openElection, weighting: 'one_vote_per_unit' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue({ id: VOTER } as any);
  vi.mocked(getResidentContext).mockResolvedValue({ estateId: ESTATE, role: 'resident' } as any);
  vi.mocked(checkVoteEligibility).mockResolvedValue({ eligible: true, reasons: [] } as any);
  vi.mocked(getVoterUnits).mockResolvedValue([{ id: UNIT_A, label: 'A / W-01' }, { id: UNIT_B, label: 'A / W-02' }] as any);
});

describe('GET /api/v1/elections/[id]/ballot — receipt over participation rows', () => {
  it('answers a weighted voter who holds two ballots with two sealed entries', async () => {
    const { client } = makeClient({
      election: weightedElection,
      participation: [
        { id: 'v1', cast_at: '2026-10-05T10:00:00Z', unit_id: UNIT_A },
        { id: 'v2', cast_at: '2026-10-05T11:00:00Z', unit_id: UNIT_B },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await getBallot(req('http://x/ballot'), params(ELECTION));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[`${ELECTION}:main:${UNIT_A}`]).toBe('sealed');
    expect(body.choices[`${ELECTION}:main:${UNIT_B}`]).toBe('sealed');
    expect(Object.keys(body.choices)).toHaveLength(2);
    expect(body.submittedAt).toBe(Date.parse('2026-10-05T11:00:00Z'));
    expect(body.units.find((u: any) => u.id === UNIT_A).voted).toBe(true);
    expect(body.outstanding).toBe(0);
  });

  it('seals a plain ballot under the single synthesized position', async () => {
    const { client } = makeClient({
      election: openElection,
      participation: [{ id: 'v1', cast_at: '2026-10-05T10:00:00Z', unit_id: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const body = await (await getBallot(req('http://x/ballot'), params(ELECTION))).json();
    expect(body.choices).toEqual({ [`${ELECTION}:main`]: 'sealed' });
    expect(body.weighted).toBe(false);
    // The receipt never carries a choice: the route must not ask for one.
    expect(JSON.stringify(body)).not.toContain(CANDIDATE);
  });

  it('shows what is still uncast for a weighted voter who has not voted', async () => {
    const { client } = makeClient({ election: weightedElection, participation: [] });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const body = await (await getBallot(req('http://x/ballot'), params(ELECTION))).json();
    expect(body.choices).toEqual({});
    expect(body.outstanding).toBe(2);
    expect(body.units.every((u: any) => u.voted === false)).toBe(true);
  });

  it('404s an election outside the caller estate instead of answering empty', async () => {
    const { client } = makeClient({ election: { ...openElection, estate_id: ESTATE + '-other' } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await getBallot(req('http://x/ballot'), params(ELECTION));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/elections/[id]/vote — ballot shape and refusal codes', () => {
  it('casts an abstention as a ballot with no candidate', async () => {
    const { client } = makeClient({ election: openElection, candidate: { id: CANDIDATE } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { positionId: `${ELECTION}:main`, abstain: true }), params(ELECTION));
    expect(res.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('estate_cast_vote', expect.objectContaining({ p_candidate_id: null }));
    const body = await res.json();
    expect(body.abstained).toBe(true);
    expect(body.choices[`${ELECTION}:main`]).toBe('sealed');
  });

  it('requires the unit a weighted ballot is cast on', async () => {
    const { client } = makeClient({ election: weightedElection });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE }), params(ELECTION));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/one vote per unit/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('refuses a ballot on a unit the voter does not hold, before the write', async () => {
    const { client } = makeClient({ election: weightedElection });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE, unitId: FOREIGN_UNIT }), params(ELECTION));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/do not hold this unit/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('passes the held unit through to estate_cast_vote', async () => {
    const { client } = makeClient({ election: weightedElection, candidate: { id: CANDIDATE } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE, unitId: UNIT_B }), params(ELECTION));
    expect(res.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('estate_cast_vote', expect.objectContaining({ p_unit_id: UNIT_B }));
    expect((await res.json()).choices[`${ELECTION}:main:${UNIT_B}`]).toBe('sealed');
  });

  it('refuses a per-unit ballot on a one-person-one-vote election', async () => {
    const { client } = makeClient({ election: openElection });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE, unitId: UNIT_A }), params(ELECTION));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/one person, one vote/i);
  });

  it('maps a replay to 409 rather than a server error', async () => {
    const { client } = makeClient({ election: openElection, candidate: { id: CANDIDATE }, rpcError: { code: '23505', message: 'already been cast' } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE }), params(ELECTION));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already voted/i);
  });

  it('names the frozen roll when the write refuses an unlisted voter', async () => {
    const { client } = makeClient({
      election: openElection,
      candidate: { id: CANDIDATE },
      rpcError: { code: '42501', message: 'voter is not on the frozen electoral roll' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE }), params(ELECTION));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not on the published electoral roll/i);
  });

  it('says the poll was cancelled when the same code comes without a roll message', async () => {
    const { client } = makeClient({
      election: openElection,
      candidate: { id: CANDIDATE },
      rpcError: { code: '42501', message: 'election has been cancelled' },
    });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE }), params(ELECTION));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/cancelled/i);
  });

  it('answers a closed window with 409, not 500', async () => {
    const { client } = makeClient({ election: openElection, candidate: { id: CANDIDATE }, rpcError: { code: '55000', message: 'election is not open for voting' } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE }), params(ELECTION));
    expect(res.status).toBe(409);
  });

  it('refuses a voter the roll gate has already excluded, without writing', async () => {
    const { client } = makeClient({ election: openElection });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(checkVoteEligibility).mockResolvedValue({ eligible: false, reasons: ['not_on_roll'] } as any);
    const res = await castVote(post('http://x/vote', { candidateId: CANDIDATE }), params(ELECTION));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('not_on_roll');
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/elections/[id]/publish — certification belongs to the service', () => {
  const closed = { ...openElection, status: 'closed', ends_at: '2026-10-05T00:00:00Z' };

  beforeEach(() => {
    vi.mocked(getResidentContext).mockResolvedValue({ estateId: ESTATE, role: 'estate_admin' } as any);
  });

  it('closes and certifies through the governance API and writes nothing itself', async () => {
    const { client, writes } = makeClient({ election: closed, updated: closed });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(proxyToGoBackend).mockResolvedValue(new Response('{}', { status: 200 }) as any);
    const res = await publishResults(post('http://x/publish', {}), params(ELECTION));
    expect(res.status).toBe(200);
    const paths = vi.mocked(proxyToGoBackend).mock.calls.map((c: any) => c[1]);
    expect(paths).toEqual([
      `/api/finance/estate/${ESTATE}/elections/${ELECTION}/tally`,
    ]);
    expect(writes).toHaveLength(0);
  });

  it('ends a poll that is still open before certifying it', async () => {
    const { client } = makeClient({ election: { ...openElection, ends_at: '2026-10-05T00:00:00Z' }, updated: closed });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(proxyToGoBackend).mockResolvedValue(new Response('{}', { status: 200 }) as any);
    const res = await publishResults(post('http://x/publish', {}), params(ELECTION));
    expect(res.status).toBe(200);
    const paths = vi.mocked(proxyToGoBackend).mock.calls.map((c: any) => c[1]);
    expect(paths).toEqual([
      `/api/finance/estate/${ESTATE}/elections/${ELECTION}/close`,
      `/api/finance/estate/${ESTATE}/elections/${ELECTION}/tally`,
    ]);
  });

  it('refuses to publish when the service says the quorum was not met', async () => {
    const { client, writes } = makeClient({ election: closed });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(proxyToGoBackend).mockResolvedValue(
      new Response(JSON.stringify({ error: 'estate: quorum not met — the result cannot be certified' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
    const res = await publishResults(post('http://x/publish', {}), params(ELECTION));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/quorum not met/i);
    expect(writes).toHaveLength(0);
  });

  it('fails closed when the governance service cannot be reached', async () => {
    const { client, writes } = makeClient({ election: closed });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(proxyToGoBackend).mockResolvedValue(
      new Response(JSON.stringify({ error: 'The upstream service could not be reached.' }), {
        status: 504, headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
    const res = await publishResults(post('http://x/publish', {}), params(ELECTION));
    expect(res.status).toBe(504);
    expect(writes).toHaveLength(0);
  });

  it('will not publish a poll whose window has not closed', async () => {
    const { client } = makeClient({ election: { ...openElection, ends_at: new Date(Date.now() + 3600e3).toISOString() } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await publishResults(post('http://x/publish', {}), params(ELECTION));
    expect(res.status).toBe(409);
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('has no result to publish for a cancelled election', async () => {
    const { client } = makeClient({ election: { ...closed, status: 'cancelled' } });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    const res = await publishResults(post('http://x/publish', {}), params(ELECTION));
    expect(res.status).toBe(409);
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('requires an estate admin', async () => {
    const { client } = makeClient({ election: closed });
    vi.mocked(createAdminClient).mockReturnValue(client as any);
    vi.mocked(getResidentContext).mockResolvedValue({ estateId: ESTATE, role: 'resident' } as any);
    const res = await publishResults(post('http://x/publish', {}), params(ELECTION));
    expect(res.status).toBe(403);
  });
});
