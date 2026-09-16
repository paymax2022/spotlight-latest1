import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// POST /api/v1/crowdfunding/campaigns/[id]/events — record a VIEW or SHARE.
//
// Feeds the real Views / Shares / Conversion / traffic-source figures on the
// creator performance screen (see the 20261228000000 migration for why those
// were previously fabricated).
//
// A signed-in caller is required here even though the Go service accepts an
// anonymous actor: every surface that currently reaches this route is behind
// auth, and requiring a user keeps the route consistent with the rest of the
// crowdfunding proxy. The anonymous path stays open in the service for a future
// public/embedded campaign page, which would need its own rate-limited route.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    const { id } = await params;
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${id}/events`);
  } catch (err) { return handleApiError(err); }
}
