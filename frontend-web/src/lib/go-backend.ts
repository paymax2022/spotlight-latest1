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

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';

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

  const upstream = await fetch(targetUrl, { method, headers, body });

  // Forward the upstream response verbatim (status + body).
  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
