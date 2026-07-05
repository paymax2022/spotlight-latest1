import { handleApiError } from '@/src/lib/api/responses';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';

// Proxy: /api/kyc/webhooks/<provider> → Go /api/kyc/webhooks/<provider>.
// KYC provider async callbacks (dojah|smileid|youverify). These carry NO user
// session — they are authenticated by a per-provider request signature that the
// Go backend re-verifies. Do NOT call requireRequestUser here.
//
// We forward directly (not via proxyToGoBackend) because signature verification
// must see BOTH the exact raw body AND the provider signature headers:
//   dojah    → X-Dojah-Signature
//   youverify→ X-Youverify-Signature
//   smileid  → signature is inside the JSON body
// proxyToGoBackend drops arbitrary headers, so it cannot be used here.
async function forward(request: Request, provider: string) {
  try {
    const rawBody = await request.text();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
    return new Response(responseBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) { return handleApiError(err); }
}
export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) { const { provider } = await ctx.params; return forward(request, provider); }
