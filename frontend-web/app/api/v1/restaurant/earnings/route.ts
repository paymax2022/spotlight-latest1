import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Proxy: GET /api/v1/restaurant/earnings → Go GET /api/finance/restaurant/earnings.
// The caller's food-delivery earnings, for the mobile owner earnings screen.
// Explicit for the same reason as ./mine — it previously matched [id] with
// id="earnings" only by coincidence.
export async function GET(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/restaurant/earnings');
  } catch (err) { return handleApiError(err); }
}
