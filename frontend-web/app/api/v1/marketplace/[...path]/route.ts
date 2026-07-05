import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/marketplace/<...> → Go /v1/marketplace/<...>.
//
// The Go marketplace module (backend/internal/app/marketplace_routes.go) mounts
// under r.Group("/v1/marketplace"), a top-level group (NOT under /api/finance).
// So we forward the sub-path verbatim to /v1/marketplace/<...>.
//
// There is no `featureFlags.marketplace()` yet, so — per the build brief — this
// proxy guards on auth only. Go itself enforces object-level authZ, the escrow
// FSM, tier-limit checks and the ledger invariants; money mutations forward the
// Idempotency-Key (proxyToGoBackend copies it verbatim).
//
// Auth policy mirrors the Go router: the public reads (GET /listings/:id,
// /search, /categories(/:id), /sellers/:id/*, /boosts/tiers) are browsable at
// KYC tier0 without a Bearer, so we do NOT hard-require a user on GET — we still
// forward the Authorization header when present (proxyToGoBackend does this) so
// authenticated reads get their per-user view. Every mutating verb requires a
// signed-in user before it reaches the Go member group.
async function forward(request: Request, path: string[], requireAuth: boolean) {
  try {
    if (requireAuth) await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/v1/marketplace/${sub}`);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path, false); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path, true); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path, true); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path, true); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path, true); }
