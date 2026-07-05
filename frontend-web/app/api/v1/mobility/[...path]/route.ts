import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/mobility/<...> → Go /api/finance/mobility/<...>.
// The Go transport handler mounts the customer-facing mobility routes under
// finance.Group("/mobility") (sibling of /transport and /driver). Auth + the
// transport feature flag guard; Go enforces object-level authZ, escrow/fare and
// the ledger invariants. Money mutations forward the Idempotency-Key.
async function forward(request: Request, path: string[]) {
  if (!featureFlags.transport()) return errorResponse('Transport is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/mobility/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
