// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The admin's review decision on a handed-in song.
 *
 * What this guards, and why it exists: `persistence.reviewSubmission` used to
 * obtain the new row by calling the IN-MEMORY store's
 * `reviewSubmission(submissionId, …)`, which begins with
 * `if (!current) throw new Error('Submission not found.')`. In DB mode that map
 * is empty by design (`ensureSeeded()` is a no-op — "Open Mic data should come
 * from real DB records"), so the projector threw for every submission that
 * actually exists: a real hand-in from mobile or the web artist dashboard is a
 * `competition_entries` row the store has never heard of. `shouldFallback()`
 * returns false, so the throw became a 500 and approving or rejecting an Open
 * Mic song was impossible on any deployment with a database — the exact
 * "admin rejects, artists see the note" half of the loop the beat-and-song
 * feature depends on. Nothing covered it, because nothing called the route.
 *
 * So the cases below are deliberately about the DB row being the only source:
 * the fake supabase answers `competition_entries` with the hand-in, and the
 * memory store is left as empty as production leaves it.
 *
 * The fake is a minimal PostgREST chain — every filter returns the same
 * thenable builder, each `update`/`insert` payload is recorded, so a case can
 * assert the column that carries the decision and the row that carries the
 * artist's notice, not just that nothing threw.
 */

type RecordedOp = { table: string; kind: 'update' | 'insert'; payload: Record<string, unknown> };

const ops: RecordedOp[] = [];
let entryRow: Record<string, unknown> | null = null;
const notificationError = { value: null as { message: string } | null };

function builder(table: string): any {
  const record: { kind?: 'update' | 'insert'; payload?: Record<string, unknown> } = {};
  const resultFor = () => {
    if (record.kind === 'insert' && table === 'open_mic_notifications') {
      return notificationError.value
        ? { data: null, error: notificationError.value }
        : { data: { ...record.payload, id: 'note-1', created_at: new Date().toISOString() }, error: null };
    }
    if (record.kind === 'insert') return { data: null, error: null };
    if (record.kind === 'update') return { data: null, error: null };
    // A read: `competition_entries` answers with the hand-in under test, or nothing.
    return { data: entryRow, error: null };
  };
  const chain: any = {
    select: () => chain,
    update: (payload: Record<string, unknown>) => ((record.kind = 'update'), (record.payload = payload), ops.push({ table, kind: 'update', payload }), chain),
    insert: (payload: Record<string, unknown>) => ((record.kind = 'insert'), (record.payload = payload), ops.push({ table, kind: 'insert', payload }), chain),
    eq: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve(resultFor()),
    single: () => Promise.resolve(resultFor()),
    then: (onOk: (v: unknown) => unknown, onErr: (reason: unknown) => unknown) => Promise.resolve(resultFor()).then(onOk, onErr),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
  createClient: () => ({ from: (table: string) => builder(table) }),
}));

vi.mock('@/lib/supabase/runtime', () => ({
  // The DB path is the one under test: shouldUseDb() must be true, otherwise
  // persistence would fall through to the in-memory store and the case would
  // pass against a code path production never takes.
  hasUsableSupabaseConfig: () => true,
  hasUsableSupabaseReadConfig: () => true,
}));

const { reviewSubmission } = await import('@/server/openmic/persistence');

/** A song hand-in as `createSubmission` writes it: an entry with an mp3 behind it. */
function handIn(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    competition_id: 'contest-1',
    entry_title: 'Third Floor Freestyle',
    lyrical_concept_summary: JSON.stringify({ stageName: 'Lady Dee', songUrl: '/api/open-mic/songs/x' }),
    category: 'Hip hop',
    status: 'published_for_voting',
    submitted_at: '2026-11-19T09:00:00.000Z',
    ...overrides,
  };
}

function updates(): RecordedOp[] {
  return ops.filter((op) => op.kind === 'update');
}

function inserts(table: string): RecordedOp[] {
  return ops.filter((op) => op.kind === 'insert' && op.table === table);
}

beforeEach(() => {
  ops.length = 0;
  entryRow = handIn();
  notificationError.value = null;
});

describe('reviewing a song hand-in against the database', () => {
  it('books the decision for a submission only the database has heard of', async () => {
    // The regression case: before the fix this rejected with "Submission not
    // found." because the projector was the empty in-memory map.
    const updated = await reviewSubmission(String(entryRow!.id), { status: 'rejected', note: 'Off-beat verse.' });
    expect(updated.status).toBe('rejected');
    expect(updated.reviewNote).toBe('Off-beat verse.');
    const entry = updates().find((op) => op.table === 'competition_entries');
    expect(entry?.payload).toMatchObject({ status: 'rejected', moderation_feedback: 'Off-beat verse.' });
    expect(inserts('moderation_logs')).toHaveLength(1);
  });

  it('keeps the rest of the hand-in intact in what it hands back', async () => {
    const updated = await reviewSubmission(String(entryRow!.id), { status: 'approved' });
    expect(updated.songTitle).toBe('Third Floor Freestyle');
    expect(updated.stageName).toBe('Lady Dee');
    expect(updated.contestId).toBe('contest-1');
    // Approving stamps the review time; a first approval has never been live.
    expect(String(entryRow!.id)).toBeTruthy();
    const payload = updates().find((op) => op.table === 'competition_entries')!.payload;
    expect(payload.reviewed_at).toBeTypeOf('string');
    expect(payload.live_at).toBeNull();
  });

  it('publishes for voting by stamping live_at and telling the artist', async () => {
    await reviewSubmission(String(entryRow!.id), { status: 'published_for_voting' });
    const payload = updates().find((op) => op.table === 'competition_entries')!.payload;
    expect(payload.status).toBe('published_for_voting');
    expect(payload.live_at).toBeTypeOf('string');
    const notice = inserts('open_mic_notifications')[0]?.payload;
    expect(notice).toMatchObject({
      contest_id: 'contest-1',
      submission_id: String(entryRow!.id),
      audience: 'artist',
      channel: 'in_app',
      event_key: 'song_approved_for_voting',
    });
    expect(String(notice!.message)).toContain('Third Floor Freestyle');
  });

  it('carries the admin note to the artist on a rejection', async () => {
    await reviewSubmission(String(entryRow!.id), { status: 'rejected', note: 'The beat is wrong — use the official one.' });
    const notice = inserts('open_mic_notifications')[0]?.payload;
    expect(notice).toMatchObject({ event_key: 'song_rejected', message: 'The beat is wrong — use the official one.' });
  });

  it('still gives a rejection a message when the note is left blank', async () => {
    await reviewSubmission(String(entryRow!.id), { status: 'correction_requested' });
    const notice = inserts('open_mic_notifications')[0]?.payload;
    expect(notice).toMatchObject({ event_key: 'song_correction_requested' });
    expect(String(notice!.message).trim()).not.toBe('');
  });

  it('does not tell the artist anything for a decision that is not about their song', async () => {
    // finalist and winner are standings moves; the in-app notice the artist acts
    // on is approval, rejection and correction — same as the memory path queued.
    await reviewSubmission(String(entryRow!.id), { status: 'finalist' });
    expect(inserts('open_mic_notifications')).toHaveLength(0);
    expect(updates().find((op) => op.table === 'competition_entries')?.payload).toMatchObject({ status: 'finalist' });
  });

  it('a failed notice does not undo the decision', async () => {
    // The row write and the audit log are the decision; a notification that
    // cannot be queued must not 500 an approval that already landed.
    notificationError.value = { message: 'open_mic_notifications is unavailable' };
    const updated = await reviewSubmission(String(entryRow!.id), { status: 'published_for_voting' });
    expect(updated.status).toBe('published_for_voting');
    expect(updates().find((op) => op.table === 'competition_entries')?.payload).toMatchObject({ status: 'published_for_voting' });
  });

  it('says not found for an id the database does not have, rather than inventing a row', async () => {
    entryRow = null;
    await expect(reviewSubmission('00000000-0000-4000-8000-000000000000', { status: 'approved' })).rejects.toThrow(/not found/i);
    expect(updates()).toHaveLength(0);
    expect(inserts('moderation_logs')).toHaveLength(0);
  });
});
