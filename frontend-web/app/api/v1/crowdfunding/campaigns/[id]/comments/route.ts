import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Campaign comments and Q&A → Go /api/finance/crowdfunding/campaigns/:id/comments.
//
// The mobile client has called these paths since the screen was written; nothing
// served them, so the comments page 404'd on load. This is the missing hop.

// GET — public. A campaign page shows its comments to anyone, so this does NOT
// require a user; proxyToGoBackend still forwards the Authorization header when
// present, which is what lets the backend mark a comment as reported BY YOU.
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
