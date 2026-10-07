import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { clientIpHeaders } from '@/src/lib/rate-limit/client-ip';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';

// → Go: POST /api/finance/crowdfunding/investment/subscribe
// Money mutation: requires an Idempotency-Key header, which the shared proxy
// helper does not forward, so this route forwards the upstream request itself
// (Authorization + Idempotency-Key + body). The Go handler enforces onboarding
// completion and the annual investment limit fail-closed.
export async function POST(request: Request) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);

  try {
    await requireRequestUser(request);

    const idempotencyKey = (request.headers.get('Idempotency-Key') ?? '').trim();
    if (!idempotencyKey) return errorResponse('Idempotency-Key header is required for investment subscriptions.', 400);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
      // Resolved client IP so Go's audit rows/limits see the caller, not the
      // BFF (AUD-BE-014).
      ...clientIpHeaders(request),
    };
    const auth = request.headers.get('Authorization') || request.headers.get('authorization');
    if (auth) headers['Authorization'] = auth;

    const body = await request.text();
    const targetUrl = `${GO_BACKEND_URL}/api/finance/crowdfunding/investment/subscribe`;
    const upstream = await fetch(targetUrl, { method: 'POST', headers, body });

    const responseBody = await upstream.text();
    // Null-body statuses (101/204/205/304) may not carry a body — the Fetch
    // Response constructor THROWS TypeError on one, so an upstream 204 would
    // surface as a 500. Same guard as proxyToGoBackend / the kyc webhook route.
    const nullBodyStatus =
      upstream.status === 101 || upstream.status === 204 ||
      upstream.status === 205 || upstream.status === 304;
    return new Response(nullBodyStatus ? null : responseBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) { return handleApiError(err); }
}
