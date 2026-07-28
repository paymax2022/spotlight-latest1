import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/transfers/<...> → Go /api/finance/transfers/<...>.
// Covers the multi-provider bank-transfers surface (ADR-011): banks,
// resolve-account, bank-to-bank, beneficiaries (+ DELETE by id), and the
// transaction-PIN routes (pin, pin/verify, pin/status). Authed — the Go backend
// enforces feature flags, tier limits, PIN, idempotency and RBAC.
//
// NOTE: sibling static routes (transfers/bank, transfers/paymax) take precedence
// in Next.js routing and are intentionally left untouched (brownfield-safe legacy
// money-path). This catch-all only handles paths not matched by those segments.
async function forward(request: Request, path: string[]) {
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/transfers/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
