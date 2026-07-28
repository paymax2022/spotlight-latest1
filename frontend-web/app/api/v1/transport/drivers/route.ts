import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

export async function POST(request: Request) {
  if (!featureFlags.transport()) return errorResponse('Transport is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/transport/drivers');
  } catch (err) { return handleApiError(err); }
}
