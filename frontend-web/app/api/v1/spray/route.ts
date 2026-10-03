import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// POST /api/v1/spray → Go POST /api/finance/p2p/spray (the spray-send money
// action). The sibling [...path] catch-all only matches /api/v1/spray/<seg>,
// not this root, so the send action itself was unreachable through the BFF.
// Go mounts spray on the P2P member group (E2E-SOC-036) — see the sibling
// route's comment for the path-map context. The Idempotency-Key is forwarded
// verbatim (money mutation).
export async function POST(request: Request) {
  if (!featureFlags.socialPay()) return errorResponse('This service is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/p2p/spray');
  } catch (err) { return handleApiError(err); }
}
