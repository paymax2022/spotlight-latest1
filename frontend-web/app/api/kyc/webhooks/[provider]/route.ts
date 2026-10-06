import { handleApiError } from '@/src/lib/api/responses';
import { clientIpHeaders } from '@/src/lib/rate-limit/client-ip';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';

// Proxy: /api/kyc/webhooks/<provider> → Go /api/kyc/webhooks/<provider>.
// session — they are authenticated by a per-provider request signature that the
// Go backend re-verifies. Do NOT call requireRequestUser here.
// We forward directly (not via proxyToGoBackend) because signature verification
// must see BOTH the exact raw body AND the provider signature headers:
//   dojah    → X-Dojah-Signature
//   youverify→ X-Youverify-Signature
//   smileid  → signature is inside the JSON body
// proxyToGoBackend drops arbitrary headers, so it cannot be used here.
async function forward(request: Request, provider: string) {
  try {
    const rawBody = await request.text();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // The provider's real edge IP — Go records it against the KYC audit row.
      ...clientIpHeaders(request),
    };
    for (const name of ['content-type', 'x-dojah-signature', 'x-youverify-signature', 'x-smile-signature']) {
      const v = request.headers.get(name);
      if (v) headers[name] = v;
    }
    const upstream = await fetch(`${GO_BACKEND_URL}/api/kyc/webhooks/${provider}`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    const responseBody = await upstream.text();
    // Null-body statuses (101/204/205/304) may not carry a body — the Fetch
    // Response constructor THROWS TypeError on one, even an empty string, so an
    // upstream 204 would surface to the provider as a 500 (and trigger retries).
    // Forward them with a null body so the status reaches the caller intact.
    const nullBodyStatus =
      upstream.status === 101 ||
      upstream.status === 204 ||
      upstream.status === 205 ||
      upstream.status === 304;
    return new Response(nullBodyStatus ? null : responseBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) { return handleApiError(err); }
}
export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) { const { provider } = await ctx.params; return forward(request, provider); }
