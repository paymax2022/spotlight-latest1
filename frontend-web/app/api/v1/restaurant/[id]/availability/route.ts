import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Proxy: PATCH /api/v1/restaurant/:id/availability
//        → Go PATCH /api/finance/restaurant/:id/availability
//
// Store open/close switch. Owner-only — object-level authz is enforced in the Go
// service (restaurant/authz.go), not here. Drives the toggle in the mobile owner
// screen (app/food/restaurant/manage.tsx) and the admin force-close action.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(
      request,
      `/api/finance/restaurant/${encodeURIComponent(id)}/availability`,
      { method: 'PATCH' },
    );
  } catch (err) { return handleApiError(err); }
}
