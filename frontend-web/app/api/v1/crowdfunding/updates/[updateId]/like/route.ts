import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// POST /api/v1/crowdfunding/updates/:updateId/like → Go equivalent.
// Idempotent at the database (one like per person per update), and the response
// carries the fresh count so the caller never has to guess.
export async function POST(request: Request, ctx: { params: Promise<{ updateId: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { updateId } = await ctx.params;
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/updates/${updateId}/like`);
  } catch (err) { return handleApiError(err); }
}
