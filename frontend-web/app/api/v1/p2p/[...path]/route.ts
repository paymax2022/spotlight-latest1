import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/p2p/<...> → Go /api/finance/p2p/<...>
// transitions, ledger/idempotency and the NL-1..12 invariants. Admin routes hit
// Go directly. Money mutations forward the Idempotency-Key.
// Gated on p2pMarket (NOT socialPay): Go mounts p2p inside RegisterP2PMarket,
// which runs only under FEATURE_P2P_MARKET_ENABLED — the flag check must
// mirror the upstream mount gate (E2E-SOC-036, same class).
// Go canonical mount: RegisterP2PMarket(finance, ...) + the handler's own
// "/p2p" prefix = /api/finance/p2p/* (an earlier double-mount produced
// /api/finance/p2p/p2p/* — fixed backend-side, E2E-SOC-036).
async function forward(request: Request, path: string[]) {
  if (!featureFlags.p2pMarket()) return errorResponse('This service is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/p2p/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function HEAD(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
