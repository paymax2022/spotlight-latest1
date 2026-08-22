/**
 * Thin proxy utility for forwarding authenticated requests to the Go backend.
 *
 * The Go backend runs at GO_BACKEND_URL (default: http://localhost:8080).
 * It expects a Bearer token in Authorization, which this utility forwards
 * from the originating browser request.
 *
 * Usage in a Next.js route handler:
 *   return proxyToGoBackend(request, '/api/finance/telemedicine/doctors');
 */
import { NextResponse } from 'next/server';

export const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';

/** Upper bound on a single upstream call. Long enough for slow money paths. */
const PROXY_TIMEOUT_MS = 30_000;

export async function proxyToGoBackend(
  request: Request,
  goPath: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = `${GO_BACKEND_URL}${goPath}${url.search}`;

  const method = options?.method ?? request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Forward the Authorization header so Go backend can validate the JWT.
  const auth = request.headers.get('Authorization') || request.headers.get('authorization');
  if (auth) headers['Authorization'] = auth;

  // Forward the Idempotency-Key VERBATIM — every money mutation requires it
  // (CLAUDE.md iron rule). Dropping it here would silently break idempotent
  // retries for all proxied transfers/charges. Also forward a request id for tracing.
  const idem = request.headers.get('Idempotency-Key') || request.headers.get('idempotency-key');
  if (idem) headers['Idempotency-Key'] = idem;
  const reqId = request.headers.get('X-Request-Id') || request.headers.get('x-request-id');
  if (reqId) headers['X-Request-Id'] = reqId;

  // Forward distributed-tracing context so a browser request and its Go-backend
  // span join ONE trace: `traceparent`/`tracestate` (W3C, for OTel) and
  // `sentry-trace`/`baggage` (Sentry). Without this the trace breaks at the gateway.
  for (const h of ['traceparent', 'tracestate', 'sentry-trace', 'baggage']) {
    const v = request.headers.get(h);
    if (v) headers[h] = v;
  }

  // Route-specific extra headers (explicit allow-list — never blanket-forward
  // the incoming request's headers to the Go backend).
  if (options?.headers) Object.assign(headers, options.headers);

  let body: BodyInit | undefined;
  if (hasBody) {
    if (options?.body !== undefined) {
      body = JSON.stringify(options.body);
    } else {
      try {
        body = await request.text();
      } catch {
        body = undefined;
      }
    }
  }

  // A bounded wait, because the alternative is an unbounded one. When the target
  // is unreachable this fetch otherwise hangs forever: the caller sees no status,
  // no body and no log line, which is precisely how a mis-baked GO_BACKEND_URL
  // stayed invisible on staging. A 504 with a message is greppable; a hang is not.
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    // Log the TARGET, not the whole request: this is the single most useful fact
    // when the proxy misbehaves, and it is the one nobody can see from outside.
    console.error(
      `[go-backend] ${method} ${goPath} -> ${GO_BACKEND_URL} ${timedOut ? 'TIMED OUT' : 'FAILED'}:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        success: false,
        error: timedOut
          ? 'The upstream service did not respond in time.'
          : 'The upstream service could not be reached.',
      },
      { status: 504 },
    );
  }

  // Forward the upstream response verbatim (status + body). Return a NextResponse
  // (not a bare Response) so the Next.js middleware's CORS headers are merged onto
  // it — cross-origin browser callers (Expo web on localhost) otherwise can't read
  // the proxied response. NextResponse is the same response type the JSON error
  // helpers return, which the middleware is already proven to decorate.
  const responseBody = await upstream.text();
  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
