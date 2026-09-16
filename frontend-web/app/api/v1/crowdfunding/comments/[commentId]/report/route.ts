import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// POST /api/v1/crowdfunding/comments/:commentId/report → Go equivalent.
// Idempotent at the database (one report per person per comment), so a double tap
// is not an error the user has to understand.
export async function POST(request: Request, ctx: { params: Promise<{ commentId: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { commentId } = await ctx.params;
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/comments/${commentId}/report`);
  } catch (err) { return handleApiError(err); }
}
