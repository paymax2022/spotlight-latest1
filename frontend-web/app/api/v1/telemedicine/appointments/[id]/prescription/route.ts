import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// GET must proxy the /api/v1/telemedicine mount — the legacy
// /api/finance/telemedicine group (used by POST below for backward compat)
// never mounted a prescription read-back, so Go only serves GetPrescription
// at /api/v1/telemedicine/appointments/:id/prescription
// (backend/internal/app/finance_routes.go). Without this export the static
// segment shadows the [...path] catch-all and GET 405'd.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.telemedicine()) return errorResponse('Telemedicine is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/v1/telemedicine/appointments/${id}/prescription`);
  } catch (err) { return handleApiError(err); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.telemedicine()) return errorResponse('Telemedicine is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/telemedicine/appointments/${id}/prescription`);
  } catch (err) { return handleApiError(err); }
}
