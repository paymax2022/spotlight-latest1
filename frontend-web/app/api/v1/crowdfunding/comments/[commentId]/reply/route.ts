import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// POST /api/v1/crowdfunding/comments/:commentId/reply → Go equivalent.
// Go enforces that only the campaign's creator may reply; this hop only proves
// there IS a caller, so an anonymous request fails here rather than deeper.
export async function POST(request: Request, ctx: { params: Promise<{ commentId: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { commentId } = await ctx.params;
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/comments/${commentId}/reply`);
  } catch (err) { return handleApiError(err); }
}
