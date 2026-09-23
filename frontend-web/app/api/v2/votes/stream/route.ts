// D-008 fix: a gated replacement for the protected, unfixable
// /api/votes/stream. That route queries vote_totals directly and streams
// total_confirmed_votes/free_votes/paid_votes/rank to any caller with NO
// call to getEffectiveVisibility() at all — a contest with vote counts or
// rank hidden (contest-level or an active phase override) still leaked live
// numbers every 5 seconds for as long as the EventSource stayed open. The
// route is on the protect-legacy.sh blocked list and its entire query +
// streaming logic lives inline with no exported function to wrap via the
// usual voting-bridge adapter pattern — there's no seam to bridge through,
// so per this repo's convention (see v2/votes/free, v2/votes/paid/verify)
// the fix is a new route, not an edit to the protected one.
//
// Same polling-SSE structure as the old route (Supabase Realtime needs
// server-side setup this repo doesn't have; polling is safe and scales for
// < 10k concurrent viewers, per the old route's own comment) — the only
// change is calling getEffectiveVisibility(contestId) on EVERY poll tick
// (not just once at connection open), so a stream that outlives an admin
// toggling visibility mid-broadcast reflects the change on its next tick
// instead of continuing to leak/hide stale state. Redaction mirrors the
// exact pattern GET /api/contestant/votes/summary (VV-002) and
// GET /api/leaderboard/[contestId] (D-005) already use: omit vote-count
// fields when !showVoteCount, omit rank when !showRank — never send a zero
// or null placeholder in their place, which would itself imply "no votes."
//
// Client migration: the ONLY real caller of the old route,
// frontend-web/app/vote/[contestSlug]/[contestantSlug]/page.tsx, now points
// at this route instead. The old route is left in place (protected, and no
// longer has any live caller) rather than deleted — deleting it would still
// require editing/removing a hook-protected file.

import { createAdminClient } from '@/lib/supabase/server';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';

interface VoteTotalRow {
  contestant_id: string;
  total_confirmed_votes: number;
  free_votes: number;
  paid_votes: number;
  rank: number | null;
  last_vote_at: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contestId = searchParams.get('contestId');
  const contestantId = searchParams.get('contestantId');

  if (!contestId) {
    return new Response('contestId is required', { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  let closed = false;

  // Fire-and-forget writes: a client that disconnects between the `closed`
  // check above and the write actually landing can make this reject after
  // the fact (the writer errors once its readable side is torn down). Same
  // .catch(() => {}) treatment as writer.close() below — the abort handler
  // is the single source of truth for tearing the connection down, not
  // these.
  function send(data: unknown) {
    if (closed) return;
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {});
  }

  function keepAlive() {
    if (!closed) {
      writer.write(encoder.encode(': ping\n\n')).catch(() => {});
    }
  }

  const supabase = createAdminClient();

  async function sendSnapshot() {
    // Re-checked on every tick, not cached for the connection's lifetime —
    // see module comment above.
    const visibility = await getEffectiveVisibility(contestId!);

    if (!visibility.showVoteCount && !visibility.showRank) {
      // Nothing this endpoint exposes is visible right now — send an empty,
      // explicitly-gated snapshot rather than silently going quiet (a client
      // that stops receiving events entirely can't distinguish "hidden" from
      // "connection stalled").
      send({ type: 'snapshot', data: [], visibility: { showVoteCount: false, showRank: false }, ts: Date.now() });
      return;
    }

    let query = supabase
      .from('vote_totals')
      .select('contestant_id, total_confirmed_votes, free_votes, paid_votes, rank, last_vote_at')
      .eq('contest_id', contestId!)
      .order('total_confirmed_votes', { ascending: false })
      .limit(1000);

    if (contestantId) {
      query = query.eq('contestant_id', contestantId);
    }

    const { data } = await query;
    const rows = (data ?? []) as VoteTotalRow[];

    const redacted = rows.map((row) => ({
      contestantId: row.contestant_id,
      lastVoteAt: row.last_vote_at,
      ...(visibility.showVoteCount
        ? {
            totalConfirmedVotes: row.total_confirmed_votes,
            freeVotes: row.free_votes,
            paidVotes: row.paid_votes,
          }
        : {}),
      ...(visibility.showRank ? { rank: row.rank } : {}),
    }));

    send({
      type: 'snapshot',
      data: redacted,
      visibility: { showVoteCount: visibility.showVoteCount, showRank: visibility.showRank },
      ts: Date.now(),
    });
  }

  await sendSnapshot();

  const pollId = setInterval(async () => {
    try {
      await sendSnapshot();
      keepAlive();
    } catch {
      // A tick racing the client's disconnect (writer already closed, or
      // getEffectiveVisibility/the query erroring on a torn-down request)
      // must not surface as an unhandled rejection — the abort handler
      // below is what actually tears the connection down.
    }
  }, 5_000);

  request.signal.addEventListener('abort', () => {
    closed = true;
    clearInterval(pollId);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
