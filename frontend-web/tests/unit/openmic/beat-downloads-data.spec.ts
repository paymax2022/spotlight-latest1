// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Beat Downloads tab of the Open Mic console.
 *
 * What this guards, and why it exists: every row of this table used to render the
 * same three invented values. Measured on the live dev deployment 2026-11-21 —
 * `GET /api/admin/open-mic/contests/c7ab8479-0275-473d-a78f-b923664a3b54/beat-downloads`
 * answered four rows, each of them `artistName: "Artist"`, `termsAccepted: true`,
 * `paidAccessConfirmed: true` — while the database behind those rows says:
 *
 *   - `beat_download_logs` stores only id, beat_id, competition_id, user_id,
 *     ip_hash, user_agent_hash, downloaded_at. No name, no consent column,
 *     no payment column (`logBeatDownload` receives an artist name and drops it,
 *     because there is nowhere to put it).
 *   - the three downloaders (6c6d04cd…, 3c1244e1…, ed2c401b…) have real
 *     `user_profiles` rows: "hello new", "teter", "Doctor", with their emails.
 *   - none of the three has a `competition_enrollments` row for this contest, so
 *     the terms and payment the tab asserted were never recorded by anyone.
 *
 * So the list must read what IS stored and stay silent about what is not: an
 * operator deciding whether an artist may use the beat needs a name they can
 * search for, and a cell that says "not recorded" must not be dressed up as
 * "Accepted".
 *
 * The fake is a table-keyed PostgREST chain: each table answers with its own rows
 * and every filter is recorded, so a case can assert the enrichment reads are
 * scoped to the artists in the log instead of pulling the whole profile table
 * onto an admin page load.
 */

type Query = { table: string; method: string; args: unknown[] };

const harness = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  broken: {} as Record<string, boolean>,
  queries: [] as Query[],
}));

function builder(table: string): any {
  const chain: any = {
    select: (...args: unknown[]) => (harness.queries.push({ table, method: 'select', args }), chain),
    eq: (...args: unknown[]) => (harness.queries.push({ table, method: 'eq', args }), chain),
    in: (...args: unknown[]) => (harness.queries.push({ table, method: 'in', args }), chain),
    order: (...args: unknown[]) => (harness.queries.push({ table, method: 'order', args }), chain),
    limit: (...args: unknown[]) => (harness.queries.push({ table, method: 'limit', args }), chain),
    then: (onOk: (v: unknown) => unknown, onErr: (reason: unknown) => unknown) =>
      Promise.resolve(
        harness.broken[table]
          ? { data: null, error: { message: `${table} read failed` } }
          : { data: harness.tables[table] ?? [], error: null }
      ).then(onOk, onErr),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
  createClient: () => ({ from: (table: string) => builder(table) }),
}));

vi.mock('@/lib/supabase/runtime', () => ({
  // The DB path is the one under test; with this false the function would return
  // [] and every assertion below would pass against a path production never takes.
  hasUsableSupabaseConfig: () => true,
  hasUsableSupabaseReadConfig: () => true,
}));

const { listBeatDownloads, listBeatDownloadUserIds } = await import('@/server/openmic/persistence');

const CONTEST_ID = 'c7ab8479-0275-473d-a78f-b923664a3b54';
const HELLO_NEW = '6c6d04cd-5635-4b94-acd1-b5378b8a2975';
const TETER = '3c1244e1-b786-465d-a876-8fb812665915';
const DOCTOR = 'ed2c401b-44b4-4074-9a1a-756b3e256225';

function download(user: string | null, at: string) {
  return {
    id: `dl-${user ?? 'anon'}-${at}`,
    beat_id: '9d140ff1-d69b-4d74-a852-960f34cce9d8',
    competition_id: CONTEST_ID,
    user_id: user,
    ip_hash: '',
    user_agent_hash: '',
    downloaded_at: at,
  };
}

function profile(id: string, full_name: string, email: string) {
  return { id, full_name, display_name: '', email, phone: '' };
}

beforeEach(() => {
  harness.queries.length = 0;
  harness.broken = {};
  harness.tables = {
    beat_download_logs: [
      download(HELLO_NEW, '2026-11-21T14:48:21.213Z'),
      download(TETER, '2026-11-21T12:28:45.392Z'),
      download(DOCTOR, '2026-11-20T21:59:01.847Z'),
      download(null, '2026-11-20T20:00:00.000Z'),
    ],
    user_profiles: [
      profile(HELLO_NEW, 'hello new', 'spec.ng+openmic@gmail.com'),
      profile(TETER, 'teter', 'spec.ng+staging1@gmail.com'),
      profile(DOCTOR, 'Doctor', 'spec.ng+doctor@gmail.com'),
    ],
    competition_enrollments: [],
  };
});

describe('listing beat downloads against the database', () => {
  it('names each downloader from the profile the database holds', async () => {
    const rows = await listBeatDownloads(CONTEST_ID);
    expect(rows.map((r) => r.artistName)).toEqual(['hello new', 'teter', 'Doctor', '']);
    expect(rows[0].artistEmail).toBe('spec.ng+openmic@gmail.com');
  });

  it('prefers the Open Mic stage name when the artist enrolled in this contest', async () => {
    harness.tables.competition_enrollments = [
      {
        user_id: HELLO_NEW,
        competition_id: CONTEST_ID,
        stage_name: 'Stage Name Wins',
        email: 'enrolled@example.test',
        terms_accepted: true,
        payment_status: 'paid',
      },
    ];
    const rows = await listBeatDownloads(CONTEST_ID);
    expect(rows[0].artistName).toBe('Stage Name Wins');
    // The consent the enrollment records is now visible instead of asserted.
    expect(rows[0].termsAccepted).toBe(true);
    expect(rows[0].paidAccessConfirmed).toBe(true);
  });

  it('leaves terms and payment unknown when nothing recorded them', async () => {
    const rows = await listBeatDownloads(CONTEST_ID);
    expect(rows[0].termsAccepted).toBeNull();
    expect(rows[0].paidAccessConfirmed).toBeNull();
  });

  it('reports a recorded refusal instead of always-accepted', async () => {
    harness.tables.competition_enrollments = [
      {
        user_id: TETER,
        competition_id: CONTEST_ID,
        stage_name: '',
        email: 'enrolled@example.test',
        terms_accepted: false,
        payment_status: 'not_required',
      },
    ];
    const rows = await listBeatDownloads(CONTEST_ID);
    const teter = rows.find((r) => r.userId === TETER);
    expect(teter?.termsAccepted).toBe(false);
    expect(teter?.paidAccessConfirmed).toBe(false);
  });

  it('still lists a download the profile table has no row for', async () => {
    harness.tables.user_profiles = harness.tables.user_profiles.filter(
      (p: any) => p.id !== DOCTOR
    );
    const rows = await listBeatDownloads(CONTEST_ID);
    const doctor = rows.find((r) => r.userId === DOCTOR);
    expect(doctor?.artistName).toBe('');
    expect(doctor?.downloadedAt).toBe('2026-11-20T21:59:01.847Z');
  });

  it('degrades to unknown identity when the profile read fails, not to an error page', async () => {
    harness.broken.user_profiles = true;
    const rows = await listBeatDownloads(CONTEST_ID);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.artistName === '')).toBe(true);
  });

  it('asks for the profiles of the downloaders only, never the whole table', async () => {
    await listBeatDownloads(CONTEST_ID);
    const profileRead = harness.queries.filter((q) => q.table === 'user_profiles');
    expect(profileRead.map((q) => q.method)).toEqual(['select', 'in']);
    const [, ids] = profileRead[1].args as [string, string[]];
    expect(ids).toEqual(expect.arrayContaining([HELLO_NEW, TETER, DOCTOR]));
    expect(ids).toHaveLength(3); // the anonymous download contributes no id
  });
});

/**
 * The Applications tab asks a narrower question than the Beat Downloads tab: for
 * each applicant, did they take the beat? It is answered from the same table, and
 * it used to be answered from a column that no writer ever sets.
 *
 * `mapApplicationRow` reads `metadata.beatDownloadStatus`, which `createApplication`
 * stamps once at insert time ('available' or 'not_available') and `logBeatDownload`
 * never revisits — so an artist who downloaded the beat goes on being listed as if
 * they had not. Measured on the dev database 2026-11-21: contest c7ab8479 has four
 * `beat_download_logs` rows (6c6d04cd…, 3c1244e1×2, ed2c401b…) and its
 * `competition_enrollments` rows carry no such metadata at all.
 *
 * So this read is the record of the hand-off, and the only place the tab can get the
 * truth from: one column, anonymous downloads skipped, and — like `latestBeatDownloadAt`
 * beside it — a failed read answers "nobody is recorded" rather than breaking the list.
 */
describe('the set of artists the log records as having downloaded', () => {
  it('returns the downloader ids the log holds, without an anonymous entry', async () => {
    const ids = await listBeatDownloadUserIds(CONTEST_ID);
    expect([...ids].sort()).toEqual([DOCTOR, HELLO_NEW, TETER].sort());
  });

  it('reads one column of the log table and no profiles', async () => {
    await listBeatDownloadUserIds(CONTEST_ID);
    expect(harness.queries.length).toBeGreaterThan(0);
    expect(new Set(harness.queries.map((q) => q.table))).toEqual(new Set(['beat_download_logs']));
    const select = harness.queries.find((q) => q.method === 'select');
    expect(String(select?.args[0])).toContain('user_id');
    expect(String(select?.args[0])).not.toContain('*');
  });

  it('scopes the read to the contest it was asked about', async () => {
    await listBeatDownloadUserIds(CONTEST_ID);
    const eq = harness.queries.find((q) => q.method === 'eq');
    expect(eq?.args).toEqual(['competition_id', CONTEST_ID]);
  });

  it('answers the empty set when the log table cannot be read', async () => {
    harness.broken.beat_download_logs = true;
    await expect(listBeatDownloadUserIds(CONTEST_ID)).resolves.toEqual([]);
  });

  it('does not query at all without a contest id', async () => {
    await expect(listBeatDownloadUserIds('')).resolves.toEqual([]);
    expect(harness.queries).toHaveLength(0);
  });
});
