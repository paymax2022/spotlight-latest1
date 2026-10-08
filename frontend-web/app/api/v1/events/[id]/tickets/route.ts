import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.events()) return errorResponse('Events are not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/events/${id}/tickets`);
  } catch (err) { return handleApiError(err); }
}

// GET — this leaf shadows the [...path] catch-all for the 2-segment path
// /api/v1/events/<seg>/tickets, which is exactly how the member's own ticket
// list is addressed: /api/v1/events/my/tickets → Go GET /api/finance/events/my/tickets
// (Go resolves the literal "my" route ahead of :id). Without this export that
// read 405'd. A real event id proxies through and 404s upstream — Go has no
// GET /:id/tickets — same answer the catch-all would have produced.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.events()) return errorResponse('Events are not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/events/${id}/tickets`);
  } catch (err) { return handleApiError(err); }
}

export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.events()) return errorResponse('Events are not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/events/${id}/tickets`, { method: 'HEAD' });
  } catch (err) { return handleApiError(err); }
}
