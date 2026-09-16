import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Campaign updates → Go /api/finance/crowdfunding/campaigns/:id/updates.
//
// The post-update screen has called POST here since it was written and nothing
// served it, so publishing an update appeared to succeed and then vanished.

// GET — the same rows are embedded in the campaign detail; this serves callers
// that want updates alone. Auth is enforced by Go's finance group, so this hop
// does not re-check it.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { id } = await ctx.params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${id}/updates`);
  } catch (err) { return handleApiError(err); }
}

// POST — Go enforces creator-only; this hop only proves there is a caller.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { id } = await ctx.params;
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${id}/updates`);
  } catch (err) { return handleApiError(err); }
}
