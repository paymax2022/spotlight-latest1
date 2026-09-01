import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Campaign supporting documents → Go /api/finance/crowdfunding/campaigns/:id/documents.
//
// The BYTES do not travel this way: they go to /api/crowdfunding/uploads/documents,
// which proxies them to R2 and hands back a URL. This endpoint only records what
// was uploaded, so a document is never half-attached — the object exists before
// any row refers to it.

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { id } = await ctx.params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${id}/documents`);
  } catch (err) { return handleApiError(err); }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { id } = await ctx.params;
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${id}/documents`);
  } catch (err) { return handleApiError(err); }
}
