import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy for the Hotel Booking / Stays member API.
//   /api/v1/stays/<...>  →  Go: /api/finance/stays/<...>
// Auth + feature-flag guarded; the Go side enforces object-level authZ, the
// two-step prebook→book saga (money held, not charged, until supplier confirms),
// NDPA consent and dedup. Ops admin (/api/stays/admin/*), hotelier extranet
// (/api/stays/extranet/*) and supplier webhooks (/internal/webhooks/*) hit Go
// directly. Money mutations (book, cancel, modify) forward the Idempotency-Key.

async function forward(request: Request, path: string[]) {
  if (!featureFlags.stays()) return errorResponse('Stays is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/stays/${sub}`);
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
