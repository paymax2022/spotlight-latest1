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
  options?: { method?: string; body?: unknown },
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
