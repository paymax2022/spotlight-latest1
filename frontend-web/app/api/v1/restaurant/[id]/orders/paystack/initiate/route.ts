import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Paystack-funded (card/bank-transfer) checkout initiate — no wallet, no
// KYC-tier gate (backend/internal/restaurant/paystackcheckout). Gated on BOTH
// flags: restaurant() for the module itself, and restaurantPaystackCheckout()
// for this specific payment rail — the Go route is ALSO gated on its own flag
// server-side, so this is belt-and-braces, not the only gate.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  if (!featureFlags.restaurantPaystackCheckout()) return errorResponse('Paystack checkout is not available for food orders.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/restaurant/${id}/orders/paystack/initiate`);
  } catch (err) { return handleApiError(err); }
}
