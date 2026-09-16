import { proxyToGoBackend } from '@/src/lib/go-backend';

/**
 * Catch-all proxy: /api/finance/<...> → Go /api/v1/<...>.
 *
 * REPLACES the `fallback` rewrite in next.config.mjs, which did not work. Two
 * independent problems made that rewrite unusable:
 *
 *  1. `rewrites()` is evaluated at BUILD time, so its destination was baked from
 *     an env var the Docker build never received (no ARG) — it compiled to
 *     http://localhost:8080 and every request hung. Fixed separately, but:
 *  2. even with the value correctly baked in, the external rewrite still never
 *     reached the network. Proven on staging with a full rebuild per arm: the
 *     private address and the public one hung identically.
 *
 * A route handler has none of those properties. It reads GO_BACKEND_URL at
 * RUNTIME (so a variable change needs only a restart, never a rebuild), it is
 * ordinary code that can be logged and tested, and — unlike an external rewrite,
 * which Next treats as opaque — its response passes through middleware, so the
 * CORS headers the Expo web build depends on are actually attached.
 *
 * Specific routes still win: Next matches app/api/finance/kyc/[...path]/route.ts before this
 * catch-all, so every existing handler keeps serving its own path. This only
 * picks up what nothing else claims — the same role `fallback` was meant to play.
 */
export const dynamic = 'force-dynamic';

async function forward(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxyToGoBackend(request, `/api/finance/${path.join('/')}`);
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
