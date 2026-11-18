import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * WEB_API_BASE_URL is read at module scope, so the route has to be imported
 * after the env is set — hence the dynamic import instead of a top-level one.
 */
async function loadRoute(baseUrl: string, timeoutMs?: string) {
  vi.resetModules();
  process.env.WEB_API_BASE_URL = baseUrl;
  process.env.ADMIN_MIDDLEWARE_ENFORCE = '0';
  if (timeoutMs !== undefined) process.env.WEB_PROXY_TIMEOUT_MS = timeoutMs;
  return import('./route');
}

const CONTEXT = {
  params: Promise.resolve({ path: ['api', 'admin', 'academy', 'batches'] }),
};

function request() {
  return new Request('http://localhost:3001/api/web-proxy/api/admin/academy/batches');
}

function rejectWith(err: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => { throw err; }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WEB_API_BASE_URL;
  delete process.env.ADMIN_MIDDLEWARE_ENFORCE;
  delete process.env.WEB_PROXY_TIMEOUT_MS;
});

describe('GET /api/web-proxy/[...path] upstream failures', () => {
  it('answers the refused socket, not a bare "unreachable"', async () => {
    const { GET } = await loadRoute('http://localhost:3000');
    rejectWith(Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), { code: 'ECONNREFUSED' }),
    }));

    const res = await GET(request(), CONTEXT);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('ECONNREFUSED');
    expect(body.error).toContain('http://localhost:3000');
  });

  it('answers the timeout with the deadline it missed', async () => {
    const { GET } = await loadRoute('http://localhost:3000', '60000');
    rejectWith(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    const res = await GET(request(), CONTEXT);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('60000ms');
    expect(body.error).toContain('WEB_PROXY_TIMEOUT_MS');
  });

  it('passes a real upstream status through unchanged', async () => {
    const { GET } = await loadRoute('http://localhost:3000');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"nope"}', {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })));

    const res = await GET(request(), CONTEXT);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'nope' });
  });
});
