import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Public proxy: /api/v1/landing/placements → Go /api/finance/placement/landing.
// UNAUTHENTICATED on purpose — the landing resolver is public/cacheable, so we
// do NOT call requireRequestUser. GET only. Go enforces flags and caching.
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await ctx.params;
    const sub = (path ?? []).join('/');
    const target = sub === 'placements' ? 'landing' : sub;
    return proxyToGoBackend(request, `/api/finance/placement/${target}`);
  } catch (err) { return handleApiError(err); }
}
