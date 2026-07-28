import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

export async function GET(request: Request, { params }: { params: Promise<{ entity_id: string }> }) {
  if (!featureFlags.ratings()) return errorResponse('Ratings are not available.', 503);
  try {
    await requireRequestUser(request);
    const { entity_id } = await params;
    return proxyToGoBackend(request, `/api/finance/ratings/${entity_id}`);
  } catch (err) { return handleApiError(err); }
}
