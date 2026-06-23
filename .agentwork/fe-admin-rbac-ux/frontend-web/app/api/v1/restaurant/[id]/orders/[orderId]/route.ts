import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; orderId: string }> }) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id, orderId } = await params;
    return proxyToGoBackend(request, `/api/finance/restaurant/${id}/orders/${orderId}/status`, { method: 'PATCH' });
  } catch (err) { return handleApiError(err); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; orderId: string }> }) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id, orderId } = await params;
    return proxyToGoBackend(request, `/api/finance/restaurant/${id}/orders/${orderId}`, { method: 'DELETE' });
  } catch (err) { return handleApiError(err); }
}
