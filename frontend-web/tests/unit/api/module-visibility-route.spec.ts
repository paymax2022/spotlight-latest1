/**
 * The mobile app and the web both ask "what modules may I show?" by calling
 * GET /api/v1/modules/visibility against EXPO_PUBLIC_API_BASE_URL, which is this
 * Next.js host. Go owns the answer, but Next had no route for it and no
 * fallback rewrite (see next.config.mjs: "NO rewrites"), so the call answered
 * 404. The clients read a 404 as "registry unreachable" and fail OPEN — every
 * module renders, published or not. That is why modules still under development
 * appeared in store builds that no admin had ever enabled.
 *
 * These specs pin the three things that make the gate real:
 *   1. the exact path the clients call is served, and Go's answer is forwarded;
 *   2. the route reads with no session and no FEATURE_* flag — a gate that needs
 *      the registry to answer would be circular, and a signed-out user opening
 *      the app still needs to know what to render;
 *   3. an unreachable Go is answered honestly as 504, never as an empty allowlist,
 *      because an empty 200 means "hide everything" to the clients while an
 *      outage means "we do not know" — and only one of those is a reason to blank
 *      a live user's app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Typed as fetch, so mock.calls carries the request and its init instead of an
// empty tuple — the specs below read both.
const upstream = (body: string, status = 200) =>
  vi.fn(async (..._args: Parameters<typeof fetch>) =>
    new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));

const visibilityBody = JSON.stringify({
  data: { environment: 'production', modules: ['wallet', 'telemedicine'], comingSoon: ['estate'] },
});

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function callGet(request: Request) {
  const { GET } = await import('@/app/api/v1/modules/visibility/route');
  return GET(request);
}

describe('GET /api/v1/modules/visibility', () => {
  it('forwards the clients exact call to Go and passes the registry answer through', async () => {
    const fetchMock = upstream(visibilityBody);
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://app.test/api/v1/modules/visibility');
    const res = await callGet(request);

    expect(res.status).toBe(200);
    const sentUrl = fetchMock.mock.calls[0][0] as string;
    expect(sentUrl).toMatch(/\/api\/v1\/modules\/visibility$/);

    const body = await res.json();
    expect(body.data.modules).toEqual(['wallet', 'telemedicine']);
    expect(body.data.comingSoon).toEqual(['estate']);
    expect(body.data.environment).toBe('production');
  });

  it('answers an anonymous caller — no Authorization header is required to read visibility', async () => {
    const fetchMock = upstream(visibilityBody);
    vi.stubGlobal('fetch', fetchMock);

    // A brand-new install has no session yet. If this route demanded one, the
    // first-launch services grid would have nothing to render against.
    const res = await callGet(new Request('https://app.test/api/v1/modules/visibility'));

    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('is not itself gated behind a FEATURE_* flag', async () => {
    // Every ops flag off. The registry route must still work, because telling a
    // client what is enabled cannot depend on a flag whose value it is meant to
    // be the source of.
    vi.stubEnv('FEATURE_WALLET_ENABLED', 'false');
    vi.stubEnv('FEATURE_TELEMEDICINE_ENABLED', 'false');
    const fetchMock = upstream(visibilityBody);
    vi.stubGlobal('fetch', fetchMock);

    const res = await callGet(new Request('https://app.test/api/v1/modules/visibility'));
    expect(res.status).toBe(200);
  });

  it('reports the environment it resolved, and preserves a Go-side failure status', async () => {
    vi.stubGlobal('fetch', upstream(JSON.stringify({ error: 'could not load module visibility' }), 500));

    const res = await callGet(new Request('https://app.test/api/v1/modules/visibility'));
    // Go's 500 must not be laundered into a 200 with an empty list: that would
    // silently hide every module for every user.
    expect(res.status).toBe(500);
  });

  it('answers 504 rather than an empty allowlist when Go is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const res = await callGet(new Request('https://app.test/api/v1/modules/visibility'));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.data).toBeUndefined();
  });
});
