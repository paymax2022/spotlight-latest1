import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// GET /api/v1/crowdfunding/wallet/[id]
// → Go: GET /api/finance/crowdfunding/campaigns/:id/wallet
// Returns the derived campaign wallet summary (no stored balance).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${params.id}/wallet`);
  } catch (err) { return handleApiError(err); }
}
