import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Proxy: /api/v1/restaurant/:id/delivery-quote → Go /api/finance/restaurant/:id/delivery-quote.
// Sibling of the existing restaurant/[id]/orders proxy. Pre-payment delivery-fee
// estimate (distance/time-based) — the mobile app's food checkout calls this
// before placeOrder; the server stays authoritative on the final fee at order time.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/restaurant/${id}/delivery-quote`);
  } catch (err) { return handleApiError(err); }
}
