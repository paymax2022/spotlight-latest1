import { proxyToGoBackend } from '@/src/lib/go-backend';

/**
 * Catch-all proxy: /api/realtor/<...> → Go /api/realtor/<...>.
 *
 * The realtor admin control plane mounts at /api/realtor/admin on the Go
 * backend (realtor.Register) — outside the /api/v1 and /api/finance prefixes
 * the existing catch-alls cover, so mobile moderation calls need this route
 * to reach them.
 */
export const dynamic = 'force-dynamic';

async function forward(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxyToGoBackend(request, `/api/realtor/${path.join('/')}`);
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
