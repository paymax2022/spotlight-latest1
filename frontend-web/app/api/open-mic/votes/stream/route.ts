// SSE endpoint — streams live vote counts for all entries in a contest.
// Each message: { type: 'snapshot', entries: [{id, voteCount, leaderboardScore}], ts }

import { createAdminClient } from '@/lib/supabase/server';
import { streamCountsVisible, type StreamCountGateRow } from '@/src/features/openmic/standings-visibility';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contestId = searchParams.get('contestId');

  if (!contestId) {
    return new Response('contestId is required', { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let closed = false;

  function send(data: unknown) {
    if (closed) return;
    writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {});
  }

  async function snapshot() {
    try {
      const supabase = createAdminClient();
      // Two signals gate the counts: a non-'public' edition and an admin who
      // marked the counts private. Open Mic editions live in `contests` —
      // reading the other plane's table returns nothing, which used to look
      // like "not public" and silently froze every live count on the board.
      // Same contract as the gated /api/v2/votes/stream: hidden fields are
      // absent, not nulled.
      const { data: contest } = await supabase
        .from('contests')
        .select('visibility, sponsor_assets')
        .eq('id', contestId!)
        .maybeSingle();
      const countsVisible = streamCountsVisible(
        (contest ?? {}) as StreamCountGateRow,
      );

      const { data } = await supabase
        .from('competition_entries')
        .select('id, public_vote_count, leaderboard_score')
        .eq('competition_id', contestId!)
        .in('status', ['submitted', 'published_for_voting', 'finalist', 'winner', 'live_for_voting'])
        .order('leaderboard_score', { ascending: false });

      send({
        type: 'snapshot',
        entries: (data ?? []).map((r: any) => ({
          id: r.id,
          ...(countsVisible
            ? {
                voteCount: Number(r.public_vote_count) || 0,
                leaderboardScore: Number(r.leaderboard_score) || 0,
              }
            : {}),
        })),
        ts: Date.now(),
      });
    } catch {
      // swallow — client will retry on reconnect
    }
  }

  await snapshot();

  // Poll every 4 seconds
  const timer = setInterval(() => {
    if (closed) { clearInterval(timer); return; }
    void snapshot();
    if (!closed) writer.write(enc.encode(': ping\n\n')).catch(() => {});
  }, 4_000);

  request.signal.addEventListener('abort', () => {
    closed = true;
    clearInterval(timer);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
