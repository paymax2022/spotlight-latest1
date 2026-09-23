/**
 * D-008 — CLOSED. Previously pinned as an open gap: GET /api/votes/stream
 * (protected-legacy, no wrappable seam — see git history of this file for
 * the original pin and its full writeup) streamed vote counts/rank with no
 * call to getEffectiveVisibility() at all.
 *
 * Fix: a new gated route, GET /api/v2/votes/stream
 * (frontend-web/app/api/v2/votes/stream/route.ts), calls
 * getEffectiveVisibility(contestId) on every poll tick and redacts
 * vote-count fields (!showVoteCount) and rank (!showRank) exactly like the
 * already-fixed GET /api/leaderboard/[contestId] (D-005) and
 * GET /api/contestant/votes/summary (VV-002) do — see those routes'
 * existing tests (leaderboard-visibility.spec.ts) for the pattern this file
 * follows. The old route's only real client
 * (app/vote/[contestSlug]/[contestantSlug]/page.tsx) now points at the new
 * one instead.
 *
 * These tests exercise the SSE handler's actual streamed payload — not the
 * route source text — since an SSE handler isn't a simple request/response
 * function to call directly. They construct a fake `Request` with an
 * AbortSignal, drain the readable stream's first chunk, and parse the SSE
 * frame back into JSON.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/voting/visibility.service', () => ({ getEffectiveVisibility: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET } from '../../../app/api/v2/votes/stream/route';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
import { createAdminClient } from '@/lib/supabase/server';

function visibility(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    showVoteCount: true,
    showLeaderboard: true,
    showRank: true,
    activePhaseKey: null,
    activePhaseLabel: null,
    source: 'contest',
    ...overrides,
  };
}

function makeSupabaseVoteTotalsMock(rows: any[]) {
  // The route chains .eq('contestant_id', ...) AFTER .limit(...) when a
  // contestantId filter is present, matching how the real Supabase query
  // builder stays chainable until actually awaited. So every method here
  // must return the same thenable chain object, not resolve early.
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: { data: any[]; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  return { from: vi.fn(() => chain) };
}

/** Reads exactly one SSE frame off the route's readable stream and parses its JSON payload. */
async function readFirstFrame(response: Response): Promise<any> {
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(value);
  const match = text.match(/^data: (.+)$/m);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
}

function makeStreamRequest(qs: string) {
  const controller = new AbortController();
  const request = new Request(`https://x.test/api/v2/votes/stream${qs}`, { signal: controller.signal });
  return { request, controller };
}

describe('D-008 (closed): GET /api/v2/votes/stream honors getEffectiveVisibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends real totals and rank when both are visible', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabaseVoteTotalsMock([
        { contestant_id: 'c1', total_confirmed_votes: 42, free_votes: 10, paid_votes: 32, rank: 1, last_vote_at: '2026-01-01T00:00:00Z' },
      ]) as any,
    );

    const { request, controller } = makeStreamRequest('?contestId=contest-1&contestantId=c1');
    const res = await GET(request);
    const frame = await readFirstFrame(res);
    controller.abort();

    expect(frame.type).toBe('snapshot');
    expect(frame.data).toHaveLength(1);
    expect(frame.data[0].totalConfirmedVotes).toBe(42);
    expect(frame.data[0].rank).toBe(1);
    expect(frame.visibility).toEqual({ showVoteCount: true, showRank: true });
  });

  it('omits vote-count fields (never zero/null placeholders) when showVoteCount is false', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility({ showVoteCount: false }) as any);
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabaseVoteTotalsMock([
        { contestant_id: 'c1', total_confirmed_votes: 42, free_votes: 10, paid_votes: 32, rank: 1, last_vote_at: null },
      ]) as any,
    );

    const { request, controller } = makeStreamRequest('?contestId=contest-1&contestantId=c1');
    const res = await GET(request);
    const frame = await readFirstFrame(res);
    controller.abort();

    expect(frame.data[0]).not.toHaveProperty('totalConfirmedVotes');
    expect(frame.data[0]).not.toHaveProperty('freeVotes');
    expect(frame.data[0]).not.toHaveProperty('paidVotes');
    // rank is still visible in this case — independent flags.
    expect(frame.data[0].rank).toBe(1);
  });

  it('omits rank when showRank is false, independent of showVoteCount', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility({ showRank: false }) as any);
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabaseVoteTotalsMock([
        { contestant_id: 'c1', total_confirmed_votes: 42, free_votes: 10, paid_votes: 32, rank: 1, last_vote_at: null },
      ]) as any,
    );

    const { request, controller } = makeStreamRequest('?contestId=contest-1&contestantId=c1');
    const res = await GET(request);
    const frame = await readFirstFrame(res);
    controller.abort();

    expect(frame.data[0].totalConfirmedVotes).toBe(42);
    expect(frame.data[0]).not.toHaveProperty('rank');
  });

  it('sends an empty, explicitly-gated snapshot (not silence) when nothing is visible — never queries vote_totals in that case', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility({ showVoteCount: false, showRank: false }) as any);
    const supabaseMock = makeSupabaseVoteTotalsMock([]);
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any);

    const { request, controller } = makeStreamRequest('?contestId=contest-1&contestantId=c1');
    const res = await GET(request);
    const frame = await readFirstFrame(res);
    controller.abort();

    expect(frame.data).toEqual([]);
    expect(frame.visibility).toEqual({ showVoteCount: false, showRank: false });
    // No leak surface at all when everything is hidden: don't even hit vote_totals.
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('re-checks visibility on every poll tick, not once at connection open — a mid-stream admin toggle takes effect on the next tick', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getEffectiveVisibility)
        .mockResolvedValueOnce(visibility() as any) // initial snapshot: visible
        .mockResolvedValueOnce(visibility({ showVoteCount: false, showRank: false }) as any); // next 5s tick: admin hid it
      vi.mocked(createAdminClient).mockReturnValue(
        makeSupabaseVoteTotalsMock([
          { contestant_id: 'c1', total_confirmed_votes: 42, free_votes: 10, paid_votes: 32, rank: 1, last_vote_at: null },
        ]) as any,
      );

      const { request, controller } = makeStreamRequest('?contestId=contest-1&contestantId=c1');
      const res = await GET(request);
      const reader = res.body!.getReader();

      const first = await reader.read();
      const firstFrame = JSON.parse(new TextDecoder().decode(first.value).match(/^data: (.+)$/m)![1]);
      expect(firstFrame.data[0].totalConfirmedVotes).toBe(42);

      // Advance past the 5s poll interval — this fires the SAME sendSnapshot
      // path again, which must re-call getEffectiveVisibility rather than
      // reuse the first tick's result.
      await vi.advanceTimersByTimeAsync(5_000);

      const second = await reader.read();
      const secondText = new TextDecoder().decode(second.value);
      const secondFrame = JSON.parse(secondText.match(/^data: (.+)$/m)![1]);

      controller.abort();
      await reader.cancel();

      expect(secondFrame.data).toEqual([]);
      expect(secondFrame.visibility).toEqual({ showVoteCount: false, showRank: false });
      expect(vi.mocked(getEffectiveVisibility)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns 400 when contestId is missing', async () => {
    const { request } = makeStreamRequest('');
    const res = await GET(request);
    expect(res.status).toBe(400);
  });
});
