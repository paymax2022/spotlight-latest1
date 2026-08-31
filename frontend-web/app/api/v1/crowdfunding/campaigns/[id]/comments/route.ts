import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Campaign comments and Q&A → Go /api/finance/crowdfunding/campaigns/:id/comments.
//
// The mobile client has called these paths since the screen was written; nothing
// served them, so the comments page 404'd on load. This is the missing hop.

// GET — no user is required AT THIS HOP. Go's finance group demands a bearer
// token regardless (as it does for the campaign detail), so an anonymous request
// still gets a 401; not re-checking here keeps one owner for that rule.
// proxyToGoBackend forwards the Authorization header, which is what lets the
// backend mark a comment as reported BY YOU.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { id } = await ctx.params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${id}/comments`);
  } catch (err) { return handleApiError(err); }
}

// POST — writing needs a signed-in author, since the row records who said it.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { id } = await ctx.params;
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${id}/comments`);
  } catch (err) { return handleApiError(err); }
}
