import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Proxy: PATCH /api/v1/restaurant/:id/orders/:orderId/status
//        → Go PATCH /api/finance/restaurant/:id/orders/:orderId/status
//
// The mobile food client posts the status advance to the FULL path including the
// trailing /status segment (src/features/food/api.ts updateOrderStatus). The
// sibling [orderId]/route.ts only matches the path WITHOUT that segment, so
// without this file the request fell through to the Go /api/v1/* fallback and
// 404'd — breaking the owner's accept → preparing → ready flow.
//
// Note the Go handler rejects a `delivered` transition here on purpose
// (ErrDeliveredViaHandoff): delivery is confirmed by the rider's handoff code.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> },
) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id, orderId } = await params;
    return proxyToGoBackend(
      request,
      `/api/finance/restaurant/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/status`,
      { method: 'PATCH' },
    );
  } catch (err) { return handleApiError(err); }
}
