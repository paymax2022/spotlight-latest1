import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Proxy: GET /api/v1/restaurant/mine → Go GET /api/finance/restaurant/mine.
// The caller's own stores, for the mobile owner console.
//
// This previously resolved only by accident: with no static `mine` segment the
// request fell through to [id]/route.ts with id="mine", which happened to build
// the correct Go path. Making it explicit removes that fragility — a future
// change to the [id] proxy would otherwise have silently broken it.
export async function GET(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/restaurant/mine');
  } catch (err) { return handleApiError(err); }
}
