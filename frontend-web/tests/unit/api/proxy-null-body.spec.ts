import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// proxyToGoBackend forwards the upstream body verbatim — but Fetch's Response
// constructor rejects a NON-NULL body on null-body statuses (101/204/205/304),
// and Go's Gin handlers answer `c.Status(204)` for dozens of successful
// mutations (mark-read, preference writes, deletes). A 204 upstream used to
// surface to the caller as a bare 500 with an empty body, reporting a
// successful write as a server fault.

function req(path = 'https://app.test/api/v1/x'): Request {
  return new Request(path, {
    method: 'PATCH',
    headers: { 'x-forwarded-for': '203.0.113.9' },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('proxyToGoBackend upstream null-body statuses', () => {
  it('passes a 204 through with its status intact (no throw, no 500)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const mod = await import('@/src/lib/go-backend');

    const res = await mod.proxyToGoBackend(req(), '/api/v1/fx/notifications/read-all');

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('passes a 304 through unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 304 })),
    );
    const mod = await import('@/src/lib/go-backend');

    const res = await mod.proxyToGoBackend(req(), '/api/v1/fx/x');

    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });

  it('still forwards a normal JSON body for 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const mod = await import('@/src/lib/go-backend');

    const res = await mod.proxyToGoBackend(req(), '/api/v1/fx/x');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
  });
});
