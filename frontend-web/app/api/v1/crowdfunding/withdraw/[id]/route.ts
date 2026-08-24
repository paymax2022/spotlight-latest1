import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';

// POST /api/v1/crowdfunding/withdraw/[id]
// → Go: POST /api/finance/crowdfunding/campaigns/:id/withdrawal-request
// [id] is the CAMPAIGN id. Money mutation: requires an Idempotency-Key header,
// which the shared proxy helper does not forward, so this route forwards the
// upstream request itself (Authorization + Idempotency-Key + body). The Go
// handler only files a PENDING request — no money is moved here.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);

  const idempotencyKey = (request.headers.get('Idempotency-Key') ?? '').trim();
  if (!idempotencyKey) return errorResponse('Idempotency-Key header is required for withdrawals.', 400);

  try {
    await requireRequestUser(request);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
    };
    const auth = request.headers.get('Authorization') || request.headers.get('authorization');
    if (auth) headers['Authorization'] = auth;

    const body = await request.text();
    const targetUrl = `${GO_BACKEND_URL}/api/finance/crowdfunding/campaigns/${params.id}/withdrawal-request`;
    const upstream = await fetch(targetUrl, { method: 'POST', headers, body });

    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) { return handleApiError(err); }
}
