import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Owner removes their own campaign from the featured rail.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/creator/campaigns/${id}/unfeature`);
  } catch (err) { return handleApiError(err); }
}
