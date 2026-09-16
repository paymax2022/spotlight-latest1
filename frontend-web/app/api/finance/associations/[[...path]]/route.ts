// Proxy: /api/finance/associations[/<...>] → Go /api/finance/associations[/<...>].
//
// The path mirrors the Go mount EXACTLY, so neither side rewrites the other:
//   finance := r.Group("/api/finance")                              // finance_routes.go:292
//   association.RegisterRoutes(finance.Group("/associations"), h)   // finance_routes.go:924
// The mobile client's ASSOCIATION_API_BASE is that same string.
//
// OPTIONAL catch-all ([[...path]]), not [...path]: the organisation list is
// registered in Go as rg.GET("") — the BARE base, /api/finance/associations with
// no suffix (routes.go:15). A required catch-all matches only one-or-more
// segments, so it would 404 the list endpoint even with the prefix correct.
//
// Auth: Bearer JWT forwarded. proxyToGoBackend also forwards Idempotency-Key
// verbatim (IRON RULE — every money mutation) plus request-id and W3C/Sentry
// tracing headers, so a browser request and its Go span stay in one trace.
// Feature-gated: FEATURE_ASSOCIATION_ENABLED=true to go live; 503 otherwise.

import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { featureFlags } from '@/src/lib/feature-flags';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

async function forward(request: Request, path?: string[]) {
  if (!featureFlags.association()) {
    return errorResponse('Association module is not available.', 503);
  }
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    // No trailing slash when the suffix is empty: gin registers the list route as
    // the bare path, and `/associations/` would 301-redirect instead of serving.
    return proxyToGoBackend(request, `/api/finance/associations${sub ? `/${sub}` : ''}`);
  } catch (err) {
    return handleApiError(err);
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, ctx: Ctx)    { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: Ctx)   { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: Ctx)    { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: Ctx)  { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: Ctx) { const { path } = await ctx.params; return forward(request, path); }
