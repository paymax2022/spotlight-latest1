import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

/**
 * Route map (audit item 19): /api/v1/fractionalre/<sub> → Go /api/finance/fractionalre/<sub>;
 * auth here, flags/authZ in Go (FEATURE_FRACTIONAL_RE_ENABLED) — no web-side flag exists,
 * so the flag check is intentionally omitted. Go also enforces the ledger invariants.
 * Money mutations rely on proxyToGoBackend's header allow-list (src/lib/go-backend.ts),
 * which forwards Idempotency-Key and X-Request-Id verbatim.
 */
async function forward(request: Request, path: string[]) {
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/fractionalre/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
