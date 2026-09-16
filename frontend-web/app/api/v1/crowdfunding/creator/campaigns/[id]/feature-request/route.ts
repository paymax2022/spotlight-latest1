import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Ask an admin to feature this campaign.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/creator/campaigns/${id}/feature-request`);
  } catch (err) { return handleApiError(err); }
}

// Withdraw a pending feature request.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/creator/campaigns/${id}/feature-request`);
  } catch (err) { return handleApiError(err); }
}
