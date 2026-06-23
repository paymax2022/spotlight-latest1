// Server-Sent Events endpoint for real-time vote count updates.
// Clients open EventSource('/api/votes/stream?contestId=X&contestantId=Y')
// and receive JSON updates whenever the vote total changes.

import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const contestId = searchParams.get('contestId');
  const contestantId = searchParams.get('contestantId');

  if (!contestId) {
    return new Response('contestId is required', { status: 400 });
  }

  // Use a TransformStream to drive the SSE response.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  let closed = false;

  function send(data: unknown) {
    if (closed) return;
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }

  function keepAlive() {
    if (!closed) {
      writer.write(encoder.encode(': ping\n\n'));
    }
  }

  // Send initial snapshot
  const supabase = createAdminClient();

  async function sendSnapshot() {
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
    send({ type: 'snapshot', data: data ?? [], ts: Date.now() });
  }

  await sendSnapshot();

  // Poll for updates every 5 seconds (Supabase Realtime requires server-side setup;
  // polling is safe and scales well for < 10k concurrent viewers).
  const pollId = setInterval(async () => {
    await sendSnapshot();
    keepAlive();
  }, 5_000);

  // Clean up when client disconnects
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
