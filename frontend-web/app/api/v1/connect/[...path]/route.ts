import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/connect/<...> → Go /api/v1/connect/<...>.
// No matching feature flag exists, so the flag check is intentionally omitted —
// Go enforces flags/authZ, safety gates and the ledger invariants. Money
// mutations forward the Idempotency-Key.
async function forward(request: Request, path: string[]) {
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    // Connect's wallet, gifting, payouts and tier-KYC handlers are mounted by
    // registerConnectWalletRoutes directly on Go's /api/v1 group, not under
    // /api/v1/connect. The mobile client addresses them as connect/wallet/*,
    // connect/kyc/* and connect/me/tier, so translate here; forwarding them
    // verbatim 404s every Connect wallet call.
    if (path?.[0] === 'wallet' || path?.[0] === 'kyc' || sub === 'me/tier') {
      return proxyToGoBackend(request, `/api/v1/${sub}`);
    }
    return proxyToGoBackend(request, `/api/v1/connect/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function HEAD(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
