import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy for the Insurance / Protection member API.
//   /api/v1/insurance/<...>  →  Go: /api/finance/insurance/<...>
// Auth + feature-flag guarded; the Go side enforces object-level authZ, KYC
// gating, NDPA consent, and the debit→bind saga. Admin routes are NOT proxied
// here (the admin app calls /api/insurance/admin/* on Go directly); provider
// webhooks hit Go's /internal/webhooks/* directly. Money mutations (bind, FNOL)
// forward the caller's Idempotency-Key header.

async function forward(request: Request, path: string[]) {
  if (!featureFlags.insurance()) return errorResponse('Insurance is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/insurance/${sub}`);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}
