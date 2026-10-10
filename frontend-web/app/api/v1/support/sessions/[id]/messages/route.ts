import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.aiCare()) return errorResponse('AI Support is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    // Shape-gate: a malformed session id is a 400 naming the field, never a
    // proxy of arbitrary text into the Go path (same gate the Go handler
    // applies — defence in depth, consistent with the estate BFF routes).
    if (!UUID_RE.test(id)) return errorResponse('session id must be a uuid', 400);
    return proxyToGoBackend(request, `/api/finance/support/sessions/${id}/messages`);
  } catch (err) { return handleApiError(err); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.aiCare()) return errorResponse('AI Support is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return errorResponse('session id must be a uuid', 400);
    return proxyToGoBackend(request, `/api/finance/support/sessions/${id}/messages`);
  } catch (err) { return handleApiError(err); }
}
