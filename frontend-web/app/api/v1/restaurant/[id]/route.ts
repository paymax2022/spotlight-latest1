import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Proxy: /api/v1/restaurant/:id (restaurant detail) → Go /api/finance/restaurant/:id.
// Sibling of the existing restaurant/[id]/orders/* proxies.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/restaurant/${id}`);
  } catch (err) { return handleApiError(err); }
}
