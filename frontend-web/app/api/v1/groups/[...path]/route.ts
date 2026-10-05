import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/groups/<...> → Go /api/finance/groups/<...>.
// Go mounts groups on the finance router (backend/internal/app/finance_routes.go:
// finance.Group("/groups") under FEATURE_GROUPS_ENABLED), so the generic
// /api/v1/[...path] fallback — which preserves the /api/v1 prefix — can never
// reach it: it forwarded /api/v1/groups/:id to Go's unmounted /api/v1/groups/:id
// and every sub-route 404'd even with the flag on (prod sweep P2). This
// catch-all is the /api/v1 → /api/finance remap, same shape as
// association/savings/p2p/[...path].
// Route priority: Next prefers the more specific handlers, so /api/v1/groups
// (groups/route.ts) and /api/v1/groups/:id/dues (groups/[id]/dues/route.ts)
// keep their own routes; this picks up :id, :id/invite and any future
// nested path. Flag-gating is preserved both sides: this 503s while
// FEATURE_GROUPS_ENABLED is unset, and Go's modulegate + mount gate refuse
// upstream independently.
async function forward(request: Request, path: string[]) {
  if (!featureFlags.groups()) return errorResponse('Groups are not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/groups/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
