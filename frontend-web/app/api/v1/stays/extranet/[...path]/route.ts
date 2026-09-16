import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy for the hotelier extranet — property/room/rate/reservation
// self-service management.
//   /api/v1/stays/extranet/<...>  →  Go: /api/stays/extranet/<...>
//
// A static "extranet" segment, so it resolves ahead of the sibling
// /api/v1/stays/[...path] catch-all (which forwards everything else to
// /api/finance/stays/<...> — a different Go route family entirely; without this
// more-specific route, a request here would 404 against the wrong backend path).
// Auth-guarded here; object-level authZ (does the caller hold an ACTIVE grant on
// THIS property) is enforced in the Go service layer on every call.

async function forward(request: Request, path: string[]) {
  if (!featureFlags.stays()) return errorResponse('Stays is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/stays/extranet/${sub}`);
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

export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}
