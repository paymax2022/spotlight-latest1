import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.aiCare()) return errorResponse('AI Support is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    // Shape-gate: malformed session id → 400 naming the field (the Go handler
    // applies the identical gate — defence in depth).
    if (!UUID_RE.test(id)) return errorResponse('session id must be a uuid', 400);
    return proxyToGoBackend(request, `/api/finance/support/sessions/${id}/resolve`);
  } catch (err) { return handleApiError(err); }
}
