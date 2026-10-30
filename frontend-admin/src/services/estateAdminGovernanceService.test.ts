// @vitest-environment jsdom
/**
 * Election governance console transport (Phase 2.2 — EST-UAT-0203…0230).
 *
 * Pins three things the estate workflow depends on:
 *  1. Governance calls are estate-scoped — the estate id is always in the path, because
 *     the Go handlers bound the election by (estate, election) and never trust the id
 *     alone. A console that dropped it would be pointing at nobody's election.
 *  2. Request bodies use the snake_case names the Go handlers bind to. A camelCase body
 *     binds as zero values, which for `roll_id` / `user_id` means a silent no-op write.
 *  3. A refused transition surfaces the service's own words. Quorum, tie-break and
 *     "already tallied" are the operator's only explanation for a blocked certification;
 *     swallowing them into "Request failed (409)" is what made this lane undiagnosable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = { url: string; init?: RequestInit };

function stubFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

const ESTATE = '9f0c1e3a-1111-4111-8111-111111111111';
const ELECTION = '9f0c1e3a-2222-4222-8222-222222222222';

async function load() {
  vi.resetModules();
  const mod = await import('@/services/estateAdminService');
  return mod;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_ESTATE_ADMIN_USE_MOCK = 'false';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_ESTATE_ADMIN_USE_MOCK;
});

describe('estate election governance transport', () => {
  it('builds the roll against the estate-scoped election route', async () => {
    const { calls } = stubFetch(201, { id: 'roll-1', election_id: ELECTION, version: 2, status: 'draft', built_at: '2026-10-20T09:00:00Z', eligible_count: 4, total_ballots: 6 });
    const mod = await load();
    const roll = await mod.buildElectionRoll(ESTATE, ELECTION);
    expect(calls[0].url).toContain(`/api/finance/estate/${ESTATE}/elections/${ELECTION}/roll/build`);
    expect(calls[0].init?.method).toBe('POST');
    expect(roll.totalBallots).toBe(6);
    expect(roll.eligibleCount).toBe(4);
  });

  it('sends the freeze body as roll_id, the name the Go handler binds', async () => {
    const { calls } = stubFetch(200, { id: 'roll-1', status: 'frozen' });
    const mod = await load();
    await mod.freezeElectionRoll(ESTATE, ELECTION, 'roll-1');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ roll_id: 'roll-1' });
  });

  it('unwraps Go\'s {data:[…]} list envelope and camelCases each row', async () => {
    stubFetch(200, {
      data: [{
        roll_id: 'roll-1', user_id: 'u-1', full_name: 'Ngozi Umeh', unit: 'A / W-01',
        occupancy_type: 'homeowner', weight: 2, source: 'built', status: 'active',
      }],
    });
    const mod = await load();
    const entries = await mod.listElectionRoll(ESTATE, ELECTION);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: 'u-1', fullName: 'Ngozi Umeh', occupancyType: 'homeowner', weight: 2 });
  });

  it('camelCases the nested candidate totals of an outcome', async () => {
    stubFetch(200, {
      election_id: ELECTION, title: 'AGM', kind: 'binding', status: 'tallied', weighting: 'one_vote_per_unit',
      binding: true, eligible_voters: 4, ballots_available: 6, voters_cast: 4, ballots_cast: 5,
      abstentions: 1, turnout_percent: 83.3, quorum_type: 'percent', quorum_value: 50,
      quorum_required: 3, quorum_met: true, tie_break: 'none', verdict: 'decided', open_complaints: 0,
      winner_ids: ['c1'],
      results: [{ id: 'c1', election_id: ELECTION, name: 'Ngozi Umeh', votes: 3 }],
    });
    const mod = await load();
    const outcome = await mod.getElectionOutcome(ESTATE, ELECTION);
    expect(outcome.ballotsAvailable).toBe(6);
    expect(outcome.verdict).toBe('decided');
    expect(outcome.winnerIds).toEqual(['c1']);
    expect(outcome.results[0].votes).toBe(3);
  });

  it('patches config with snake_case nulls so an untouched field is not reset', async () => {
    const { calls } = stubFetch(200, { id: ELECTION, status: 'draft' });
    const mod = await load();
    await mod.updateElectionConfig(ESTATE, ELECTION, { weighting: 'one_vote_per_unit', quorumValue: 50 });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({
      weighting: 'one_vote_per_unit', quorum_value: 50,
      // Empty string / null means "leave as is" server-side.
      kind: '', nomination_opens_at: null,
    });
  });

  it('surfaces a refused certification verbatim', async () => {
    stubFetch(409, { error: 'estate: quorum not met (2 of 3 ballots required)' });
    const mod = await load();
    await expect(mod.tallyElection(ESTATE, ELECTION)).rejects.toThrow(/quorum not met/);
  });

  it('surfaces the membership refusal instead of a bare status code', async () => {
    stubFetch(403, { error: 'estate: not an administrator of this estate' });
    const mod = await load();
    await expect(mod.listNominations(ESTATE, ELECTION)).rejects.toThrow(/administrator/);
  });

  it('files a complaint against the estate-scoped route with the detail the schema demands', async () => {
    const { calls } = stubFetch(201, { id: 'cp-1', kind: 'complaint', state: 'open', detail: 'Unit missing from the published roll' });
    const mod = await load();
    await mod.fileElectionComplaint(ESTATE, ELECTION, 'complaint', 'Unit missing from the published roll');
    expect(calls[0].url).toContain(`/estate/${ESTATE}/elections/${ELECTION}/complaints`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ kind: 'complaint', detail: 'Unit missing from the published roll' });
  });
});
