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
    return proxyToGoBackend(request, `/api/finance/restaurant/${encodeURIComponent(id)}`);
  } catch (err) { return handleApiError(err); }
}

// Edit a store profile. PATCH /api/v1/restaurant/:id → Go PATCH /api/finance/restaurant/:id.
// Owner-only; object-level authz is enforced in the Go service (restaurant/authz.go).
// Without this export the route answered 405 and the mobile owner "edit profile"
// form could not save against a real backend.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/restaurant/${encodeURIComponent(id)}`, { method: 'PATCH' });
  } catch (err) { return handleApiError(err); }
}
