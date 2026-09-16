import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Message contributors → Go /api/finance/crowdfunding/campaigns/:id/broadcast.
//
// The mobile "Message contributors" screen (app/crowdfunding/creator/
// performance/[id].tsx) has called POST here since it was written and nothing
// served it — every real send 404'd (UAT finding CF-008).

// POST — Go enforces creator-only; this hop only proves there is a caller.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    const { id } = await ctx.params;
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${id}/broadcast`);
  } catch (err) { return handleApiError(err); }
}
