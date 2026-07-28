import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.transport()) return errorResponse('Transport is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/transport/trips/${id}/accept`);
  } catch (err) { return handleApiError(err); }
}
