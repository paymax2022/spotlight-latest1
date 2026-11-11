import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/referrals/<...> → Go /v1/referrals/<...>
// service enforces object-level authZ (own data only), idempotent attribution,
// and the reward/ledger invariants. State-changing calls forward the
// Idempotency-Key verbatim (proxyToGoBackend handles that).
//
// Gated on referralRewards, NOT referrals: /v1/referrals/* is the Direct Rewards
// engine, mounted by FEATURE_REFERRAL_REWARDS_ENABLED on Go's root engine
// (finance_routes.go:468). The §7A FEATURE_REFERRALS_ENABLED block above it
// mounts a different prefix (/api/finance/referral/*), which the sibling
// /api/v1/referral/<...> proxy forwards to.
async function forward(request: Request, path: string[]) {
  if (!featureFlags.referralRewards()) return errorResponse('This service is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/v1/referrals/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function HEAD(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
