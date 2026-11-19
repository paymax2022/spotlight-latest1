// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A minimal PostgREST-chainable fake: every filter method returns the same
 * thenable builder, so the module's `await supabase.from(t).select().eq().limit(1)`
 * resolves, and each call is recorded so the test can assert *which* tables the
 * gate consulted and in what order — the ordering is the design (roster first,
 * one query when it answers).
 */
type RecordedCall = { table: string; filters: string[] };
const calls: RecordedCall[] = [];
let tablesWithRows = new Set<string>();

function makeBuilder(table: string): any {
  const record: RecordedCall = { table, filters: [] };
  calls.push(record);
  const builder: any = {
    select: () => builder,
    eq: (key: string, value: unknown) => (record.filters.push(`${key}.eq.${value}`), builder),
    in: (key: string, values: unknown[]) => (record.filters.push(`${key}.in.(${values.join(',')})`), builder),
    or: (expression: string) => (record.filters.push(`or.(${expression})`), builder),
    limit: () => builder,
    then: (onOk: (value: { data: unknown[]; error: null }) => unknown, onErr: (reason: unknown) => unknown) =>
      Promise.resolve({ data: tablesWithRows.has(table) ? [{ id: 'row' }] : [], error: null }).then(onOk, onErr),
  };
  return builder;
}

const from = vi.fn((table: string) => makeBuilder(table));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from }),
}));

const { classifyEligibility, getSongSubmissionEligibility, eligibilityForbiddenBody } = await import(
  '@/server/openmic/submission-eligibility'
);

const NOW = Date.parse('2026-11-19T12:00:00.000Z');

function contest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cid',
    slug: 'open-mic-november-2026',
    beat: { id: 'bid' },
    status: 'submission_open',
    ...overrides,
  } as any;
}

function tables(): string[] {
  return calls.map((call) => call.table);
}

function filtersFor(table: string): string {
  return calls
    .filter((call) => call.table === table)
    .map((call) => call.filters.join(' '))
    .join(' | ');
}

beforeEach(() => {
  from.mockClear();
  calls.length = 0;
  tablesWithRows = new Set();
});

describe('classifyEligibility', () => {
  it('says ok for an approved artist with a beat in an open window', () => {
    const verdict = classifyEligibility({ contest: contest(), userId: 'u1', promoted: true, enrollment: false, registration: false, nowMs: NOW });
    expect(verdict).toMatchObject({ eligible: true, source: 'promoted', reason: 'ok' });
  });

  it('has no opinion about approval when there is no edition', () => {
    expect(classifyEligibility({ contest: null, userId: 'u1', promoted: false, enrollment: false, registration: false }).reason).toBe('no_contest');
  });

  it('requires a beat, a source and a user', () => {
    expect(classifyEligibility({ contest: contest(), userId: null, promoted: false, enrollment: false, registration: false }).reason).toBe('not_approved');
    expect(classifyEligibility({ contest: contest(), userId: 'u1', promoted: false, enrollment: false, registration: false }).reason).toBe('not_approved');
    expect(classifyEligibility({ contest: contest({ beat: undefined }), userId: 'u1', promoted: true, enrollment: true, registration: true }).reason).toBe('beat_missing');
  });

  it('blames the admin before the calendar', () => {
    // An approved artist whose edition has neither a beat nor an open window is
    // blocked on the beat; saying "closed" would send them to the wrong person.
    const verdict = classifyEligibility({
      contest: contest({ beat: undefined, status: 'published', submissionStartAt: undefined, submissionEndAt: undefined }),
      userId: 'u1',
      promoted: true,
      enrollment: false,
      registration: false,
      nowMs: NOW,
    });
    expect(verdict.reason).toBe('beat_missing');
  });

  it('reports the window with its dates so a screen can name them', () => {
    const verdict = classifyEligibility({
      contest: contest({ status: 'published', submissionStartAt: '2026-12-01T00:00:00.000Z', submissionEndAt: '2026-12-31T00:00:00.000Z' }),
      userId: 'u1',
      promoted: false,
      enrollment: true,
      registration: false,
      nowMs: NOW,
    });
    expect(verdict.reason).toBe('window_closed');
    expect(verdict.window.startsAt).toBe('2026-12-01T00:00:00.000Z');
    expect(verdict.source).toBe('enrollment');
  });

  it('prefers promoted over enrollment over registration', () => {
    const base = { contest: contest(), userId: 'u1', nowMs: NOW } as const;
    expect(classifyEligibility({ ...base, promoted: true, enrollment: true, registration: true }).source).toBe('promoted');
    expect(classifyEligibility({ ...base, promoted: false, enrollment: true, registration: true }).source).toBe('enrollment');
    expect(classifyEligibility({ ...base, promoted: false, enrollment: false, registration: true }).source).toBe('registration');
  });
});

describe('getSongSubmissionEligibility', () => {
  it('short-circuits without touching Supabase when there is no edition or no user', async () => {
    expect((await getSongSubmissionEligibility(null, 'u1')).reason).toBe('no_contest');
    expect((await getSongSubmissionEligibility(contest(), null)).reason).toBe('not_approved');
    expect(calls).toHaveLength(0);
  });

  it('reads the roster first and matches either mirrored contest key', async () => {
    tablesWithRows = new Set(['contestants']);
    const verdict = await getSongSubmissionEligibility(contest(), 'u1', NOW);
    expect(verdict).toMatchObject({ eligible: true, source: 'promoted' });
    expect(tables()).toEqual(['contestants']);
    // contests/connect_contests are mirrored twins sharing one primary key and the
    // promotion seam writes both columns, so matching either survives the merge.
    expect(filtersFor('contestants')).toContain('or.(contest_id.eq.cid,connect_contest_id.eq.cid)');
    expect(filtersFor('contestants')).toContain('user_id.eq.u1');
  });

  it('walks the three planes when the roster does not answer', async () => {
    tablesWithRows = new Set(['registrations']);
    const verdict = await getSongSubmissionEligibility(contest(), 'u1', NOW);
    expect(verdict).toMatchObject({ eligible: true, source: 'registration' });
    expect(tables()).toEqual(['contestants', 'competition_enrollments', 'registrations']);
    expect(filtersFor('competition_enrollments')).toContain('competition_id.eq.cid');
    expect(filtersFor('competition_enrollments')).toContain('status.in.(approved)');
  });

  it('stops at the enrollment and never asks about promotions below it', async () => {
    tablesWithRows = new Set(['competition_enrollments']);
    const verdict = await getSongSubmissionEligibility(contest(), 'u1', NOW);
    expect(verdict.source).toBe('enrollment');
    expect(tables()).toEqual(['contestants', 'competition_enrollments']);
  });

  it('accepts a registration filed under the catalog slug as Open Mic approval', async () => {
    tablesWithRows = new Set(['registrations']);
    await getSongSubmissionEligibility(contest({ slug: 'open-mic-december-2026' }), 'u1', NOW);
    // registrations.contest_slug is TEXT and holds the catalog slug while an edition
    // row has its own; the alias list is what stops telling an approved applicant
    // they are not approved.
    expect(filtersFor('registrations')).toContain('contest_slug.in.(open-mic-december-2026,open-mic-competition,open-mic,open-mic-2026)');
    expect(filtersFor('registrations')).toContain('status.in.(approved,selected_for_public_voting,selected_for_bootcamp)');
  });

  it('says not_approved when no plane recognises the user', async () => {
    const verdict = await getSongSubmissionEligibility(contest(), 'u1', NOW);
    expect(verdict).toMatchObject({ eligible: false, reason: 'not_approved', source: 'none' });
    expect(tables()).toEqual(['contestants', 'competition_enrollments', 'registrations']);
  });

  it('propagates a query failure instead of degrading to not_approved', async () => {
    // A swallowed Supabase error would read as "you are not approved" to an
    // applicant who is, which is the worse failure.
    from.mockImplementationOnce(() => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        limit: () => builder,
        then: (_ok: unknown, onErr: (reason: unknown) => unknown) => Promise.reject(new Error('boom')).catch(onErr),
      };
      return builder;
    });
    await expect(getSongSubmissionEligibility(contest(), 'u1', NOW)).rejects.toThrow('boom');
  });
});

describe('eligibilityForbiddenBody', () => {
  it('carries the reason and the dates, never a stack', () => {
    const verdict = classifyEligibility({
      contest: contest({ status: 'published', submissionEndAt: '2026-11-01T00:00:00.000Z' }),
      userId: 'u1',
      promoted: false,
      enrollment: false,
      registration: true,
      nowMs: NOW,
    });
    const body = eligibilityForbiddenBody(verdict);
    expect(body.reason).toBe('window_closed');
    expect(body.source).toBe('registration');
    expect(body.submissionDeadline).toBe('2026-11-01T00:00:00.000Z');
    expect(body.message).toMatch(/closed/i);
    expect(JSON.stringify(body)).not.toMatch(/at .*:\d+:\d+/);
  });
});
