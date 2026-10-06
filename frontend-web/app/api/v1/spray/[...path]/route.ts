import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/spray/<...> → Go /api/finance/p2p/spray/<...>
// The Go backend mounts the shared spray engine on the P2P member group
// (backend/internal/spray/service.go Handler.Register on the /api/finance/p2p
// group — NOT a standalone /api/finance/spray group, which is what this route
// used to proxy to and why every spray call upstream-404'd: E2E-SOC-036).
// transitions, ledger/idempotency and the NL-1..12 invariants. Admin routes hit
// Go directly. Money mutations forward the Idempotency-Key.
// Gated on p2pMarket (NOT socialPay): Go mounts the spray engine inside
// RegisterP2PMarket, which runs only under FEATURE_P2P_MARKET_ENABLED — this
// flag check must mirror that mount gate or the proxy either 503s a healthy
// upstream or forwards into an unmounted 404 (E2E-SOC-036).
async function forward(request: Request, path: string[]) {
  if (!featureFlags.p2pMarket()) return errorResponse('This service is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/p2p/spray${sub ? `/${sub}` : ''}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function HEAD(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
