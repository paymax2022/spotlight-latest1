import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

export async function GET(request: Request) {
  if (!featureFlags.disputes()) return errorResponse('Disputes are not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/disputes');
  } catch (err) { return handleApiError(err); }
}

export async function POST(request: Request) {
  if (!featureFlags.disputes()) return errorResponse('Disputes are not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/disputes');
  } catch (err) { return handleApiError(err); }
}
