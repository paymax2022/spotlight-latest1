/**
 * The Open Mic vote stream must not carry counts the admin marked private.
 *
 * `app/api/open-mic/votes/stream/route.ts` already had a redaction path, but it
 * looked the edition row up in `competitions` — a table the Open Mic plane never
 * writes. The read came back empty, `visibility === 'public'` was never true,
 * and every browser that opened an EventSource got ids only: the leaderboard
 * showed server counts, then never updated. Open Mic editions live in
 * `contests`, which carries both `visibility` and `sponsor_assets.voting`.
 *
 * These tests read the route's actual first frame rather than its source, so
 * what is asserted is what a client receives.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET } from '@/app/api/open-mic/votes/stream/route';
import { createAdminClient } from '@/lib/supabase/server';

const ENTRIES = [
  { id: 'e1', public_vote_count: 412, leaderboard_score: 412 },
  { id: 'e2', public_vote_count: 388, leaderboard_score: 388 },
];

/** One fluent chain per table; every chain answers both terminals so a read
 *  against the wrong table shows up as a missing count, not a hung stream.
 *  `asked` records which tables the route actually read. */
function mockDb(contestRow: Record<string, unknown> | null) {
  const asked: string[] = [];
  const chains = new Map<string, Record<string, unknown>>();

  function chain(table: string, row: unknown) {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve({ data: row, error: null });
    c.order = () => Promise.resolve({ data: row, error: null });
    chains.set(table, c);
    return c;
  }

  // `contests` is the Open Mic edition table — the row that carries
  // `visibility` and `sponsor_assets.voting`. `competition_entries` holds the
  // entries; every other table is empty, as it would be in a real database.
  chain('contests', contestRow);
  chain('competition_entries', ENTRIES);

  return {
    asked,
    from(table: string) {
      asked.push(table);
      return chains.get(table) ?? chain(table, null);
    },
  };
}

/** Read exactly one SSE frame, then abort so the route's 4 s poll stops. */
async function firstFrame(contestRow: Record<string, unknown> | null) {
  const db = mockDb(contestRow);
  vi.mocked(createAdminClient).mockReturnValue(db as never);
  const ac = new AbortController();
  const res = await GET(
    new Request('https://x.test/api/open-mic/votes/stream?contestId=c1', { signal: ac.signal }),
  );
  const { value } = await (res.body as ReadableStream<Uint8Array>).getReader().read();
  ac.abort();
  return {
    asked: db.asked,
    frame: JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '').trim()) as {
      type: string;
      entries: { id: string; voteCount?: number; leaderboardScore?: number }[];
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('Open Mic vote stream count redaction', () => {
  it('reads the edition row from the Open Mic contests table', async () => {
    // The gate once asked a different plane's table, which holds no Open Mic
    // rows, so it saw no switches and withheld counts from every browser
    // forever — the board rendered server counts and then went dead.
    const { asked } = await firstFrame({ visibility: 'public', sponsor_assets: {} });
    expect(asked).toContain('contests');
  });

  it('omits counts from every entry when the admin marked them private', async () => {
    const { frame } = await firstFrame({
      visibility: 'public',
      sponsor_assets: { voting: { voteCountPublic: false } },
    });
    expect(frame.type).toBe('snapshot');
    expect(frame.entries.map((e) => e.id)).toEqual(['e1', 'e2']);
    for (const entry of frame.entries) {
      expect(entry).not.toHaveProperty('voteCount');
      expect(entry).not.toHaveProperty('leaderboardScore');
    }
  });

  it('sends counts for a public contest that leaves them public', async () => {
    const { frame } = await firstFrame({
      visibility: 'public',
      sponsor_assets: { voting: { voteCountPublic: true } },
    });
    expect(frame.entries[0]).toMatchObject({ id: 'e1', voteCount: 412 });
  });

  it('still omits counts for a contest that is not publicly listed', async () => {
    // The rule that predates this change, pinned so the new check cannot
    // widen it.
    const { frame } = await firstFrame({
      visibility: 'hidden',
      sponsor_assets: { voting: { voteCountPublic: true } },
    });
    expect(frame.entries[0]).not.toHaveProperty('voteCount');
  });

  it('sends counts for a public contest whose assets carry no voting block', async () => {
    // Default-on: rows written before the admin form grew the switch.
    const { frame } = await firstFrame({ visibility: 'public', sponsor_assets: {} });
    expect(frame.entries[0]).toMatchObject({ voteCount: 412 });
  });
});
