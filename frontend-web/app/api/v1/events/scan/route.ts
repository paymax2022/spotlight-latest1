import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Steward scan leaf — POST /api/v1/events/scan → Go POST /api/finance/events/scan.
// This static segment exists because [id]/route.ts shadows the [...path]
// catch-all for every single-segment path (the same hazard the [id]/tickets
// leaf documents): without it a POST to /scan hit the [id] leaf, which exports
// only GET, and Next answered 405 — the steward scan was unreachable via the
// canonical v1 path while /api/finance/events/scan worked directly.
export async function POST(request: Request) {
  if (!featureFlags.events()) return errorResponse('Events are not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/events/scan');
  } catch (err) { return handleApiError(err); }
}

// GET parity: before this leaf existed the [id] leaf proxied GET /scan to
// Go's /:id handler with id="scan" (a non-UUID → upstream 4xx). Proxying the
// same upstream path keeps that answer identical rather than turning it into
// a local 405.
export async function GET(request: Request) {
  if (!featureFlags.events()) return errorResponse('Events are not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/events/scan');
  } catch (err) { return handleApiError(err); }
}
