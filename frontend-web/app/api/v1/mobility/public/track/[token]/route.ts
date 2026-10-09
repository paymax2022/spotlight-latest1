import { featureFlags } from '@/src/lib/feature-flags';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Public ride-share tracking: Go mounts GET /api/finance/mobility/public/track/:token
// without auth (the share token is the credential — recipients have no account),
// but the sibling [...path] catch-all gates everything behind requireRequestUser.
// This dedicated route restores the public path so share links work anonymously.
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!featureFlags.transport()) return errorResponse('Transport is not available.', 503);
  try {
    const { token } = await ctx.params;
    if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) return errorResponse('Invalid share link', 400);
    return proxyToGoBackend(request, `/api/finance/mobility/public/track/${encodeURIComponent(token)}`);
  } catch (err) { return handleApiError(err); }
}
