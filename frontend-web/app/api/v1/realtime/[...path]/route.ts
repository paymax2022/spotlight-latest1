import { requireRequestUser } from '@/src/lib/auth/request';
import { GO_BACKEND_URL } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// ── Dedicated SSE streaming proxy: /api/v1/realtime/* → Go /api/v1/realtime/* ──
//
// The catch-all at app/api/v1/[...path]/route.ts forwards via proxyToGoBackend,
// which BUFFERS the upstream body (upstream.text()) before responding — fatal for
// Server-Sent Events, which must flush frame-by-frame and never close. This more
// specific segment ([...path] under /realtime) takes precedence over the catch-all
// for /api/v1/realtime/*, so those requests stream through here instead.
//
// We pipe the Go backend's ReadableStream straight through the Response body — no
// buffering — and set the SSE headers (plus X-Accel-Buffering: no to stop nginx/
// Passenger from buffering the event stream). force-dynamic + nodejs runtime keep
// it out of static optimization / edge caching.
//
// Only GET is needed: the EventSource client opens a long-lived GET. Auth mirrors
// the sibling proxies (requireRequestUser); the Authorization Bearer is forwarded
// so the Go side re-validates the Supabase JWT and scopes the stream to the user.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    await requireRequestUser(request);
    const { path } = await ctx.params;
    const sub = (path ?? []).join('/');
    const url = new URL(request.url);
    const targetUrl = `${GO_BACKEND_URL}/api/v1/realtime/${sub}${url.search}`;

    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const auth =
      request.headers.get('Authorization') || request.headers.get('authorization');
    if (auth) headers.Authorization = auth;

    // No timeout — SSE is a long-lived stream. Forward the client abort so the
    // upstream fetch (and thus the Go connection) tears down when the client leaves.
    const goResp = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: request.signal,
      // @ts-expect-error — Node fetch honours this to disable response buffering.
      duplex: 'half',
    });

    // Surface upstream failures (e.g. flag off → 404/503, auth → 401) as-is instead
    // of masquerading them as a live stream.
    if (!goResp.ok || !goResp.body) {
      const body = await goResp.text().catch(() => '');
      return new Response(body || null, {
        status: goResp.status,
        headers: { 'Content-Type': goResp.headers.get('Content-Type') ?? 'application/json' },
      });
    }

    // Pass the upstream ReadableStream straight through — frame-by-frame, unbuffered.
    return new Response(goResp.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
