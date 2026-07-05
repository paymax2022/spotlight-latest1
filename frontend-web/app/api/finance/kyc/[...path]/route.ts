import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/finance/kyc/<...> → Go /api/finance/kyc/<...>.
// Member KYC verification surface (multi-provider, ADR-013). Go enforces the
// feature flag, consent precondition, idempotency, and routing/authZ. The
// Idempotency-Key header is forwarded verbatim by proxyToGoBackend — required
// for every /kyc/checks/* POST (it becomes the provider client_ref).
async function forward(request: Request, path: string[]) {
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/kyc/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
