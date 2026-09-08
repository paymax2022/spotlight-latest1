import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// GET one appointment.
//
// This route previously exported DELETE only, and Next.js prefers the more
// specific route over the sibling [...path] catch-all — so a GET to
// /api/v1/telemedicine/appointments/<id> matched HERE and returned 405, even
// though the catch-all supports GET and Go has served
// GET /api/v1/telemedicine/appointments/:id (GetAppointment) all along. The
// catch-all's own comment assumed it covered this path; it never could.
//
// Proxies to the v1 group, not the legacy /api/finance/... one DELETE uses:
// the legacy group registers no GET for a single appointment.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.telemedicine()) return errorResponse('Telemedicine is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/v1/telemedicine/appointments/${id}`);
  } catch (err) { return handleApiError(err); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.telemedicine()) return errorResponse('Telemedicine is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/telemedicine/appointments/${id}`, { method: 'DELETE' });
  } catch (err) { return handleApiError(err); }
}
