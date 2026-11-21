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

/**
 * Open Mic hands the console an <audio> element and a download button, both of
 * which point their src/href at this proxy (src/features/openmic/song-src.ts).
 * A media element asks for a byte range and a download asks for a disposition,
 * so the headers that carry those two things are part of the payload, not
 * metadata we may drop: forwarding `Range` and returning `Content-Range`,
 * `Accept-Ranges` and `Content-Disposition` verbatim is what makes the console's
 * player seekable and its download button download instead of play.
 */
describe('GET /api/web-proxy/[...path] audio and download headers', () => {
  const SONG_CTX = {
    params: Promise.resolve({ path: ['api', 'open-mic', 'songs', 'a1d98b6e-0000-4000-8000-000000000000'] }),
  };

  it("forwards the caller's Range header to the web app", async () => {
    const { GET } = await loadRoute('http://localhost:3005');
    const seen: Array<Record<string, string | undefined>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers ?? {});
      return new Response(new Uint8Array([1, 2, 3]), { status: 206 });
    }));

    await GET(new Request('http://localhost:3006/api/web-proxy/api/open-mic/songs/a1d98b6e-0000-4000-8000-000000000000', {
      headers: { Range: 'bytes=1000-2000' },
    }), SONG_CTX);

    expect(seen[0].Range).toBe('bytes=1000-2000');
  });

  it('keeps the partial-response headers the browser needs to trust a 206', async () => {
    const { GET } = await loadRoute('http://localhost:3005');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(1001), {
      status: 206,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Range': 'bytes 1000-2000/112893',
        'Accept-Ranges': 'bytes',
      },
    })));

    const res = await GET(new Request('http://localhost:3006/api/web-proxy/api/open-mic/songs/a1d98b6e-0000-4000-8000-000000000000', {
      headers: { Range: 'bytes=1000-2000' },
    }), SONG_CTX);

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 1000-2000/112893');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('keeps the attachment disposition a download button asks for', async () => {
    const { GET } = await loadRoute('http://localhost:3005');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(8), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'attachment; filename="song.mp3"',
        'Accept-Ranges': 'bytes',
      },
    })));

    const res = await GET(
      new Request('http://localhost:3006/api/web-proxy/api/open-mic/songs/a1d98b6e-0000-4000-8000-000000000000?download=1'),
      SONG_CTX,
    );

    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="song.mp3"');
  });

  it('still answers JSON with a Content-Type and nothing else inherited', async () => {
    const { GET } = await loadRoute('http://localhost:3005');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"success":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const res = await GET(request(), CONTEXT);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(await res.json()).toEqual({ success: true });
  });
});
