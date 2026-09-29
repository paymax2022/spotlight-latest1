import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// GET /api/v1/connect/share/:token — PUBLIC, no auth.
//
// This one path under /api/v1/connect/* is deliberately NOT behind the
// catch-all proxy at ../[...path]/route.ts, which calls requireRequestUser()
// on every request. A share link is followed by a stranger who has never
// signed in — the web landing page (app/vote/[token]) calls this to find out
// who they're being asked to vote for BEFORE any session exists. Next.js
// matches this more specific route ahead of the catch-all for this exact
// path shape, so the catch-all's auth requirement never applies here.
//
// Go itself also serves this route with no auth middleware (connectvoting.
// RegisterPublic) and is gated behind FEATURE_CONTESTANT_SOCIAL_ENABLED — the
// feature flag, not a session, is what decides whether this resolves.
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    return proxyToGoBackend(request, `/api/v1/connect/share/${encodeURIComponent(token)}`);
  } catch (err) {
    return handleApiError(err);
  }
}
