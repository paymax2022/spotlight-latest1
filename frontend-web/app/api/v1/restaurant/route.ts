import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Proxy: /api/v1/restaurant (discovery list) → Go /api/finance/restaurant.
// Sibling of the existing restaurant/[id]/* and restaurant/orders|rider/* proxies.
export async function GET(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/restaurant');
  } catch (err) { return handleApiError(err); }
}

// Create a store. POST /api/v1/restaurant → Go POST /api/finance/restaurant.
// Drives "create store" in the mobile owner screen (app/food/restaurant/manage.tsx)
// and the admin restaurant console. Without this export the route answered 405 and
// merchant onboarding could not complete against a real backend.
export async function POST(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/restaurant', { method: 'POST' });
  } catch (err) { return handleApiError(err); }
}
