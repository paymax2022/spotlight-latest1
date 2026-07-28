import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/arena/<...> → Go /api/arena/<...>.
// Arena competition engine (ADR-014). Go enforces the feature flag
// (FEATURE_ARENA_ENABLED), scoped RBAC, idempotency, the Merit firewall (NDC-1),
// and all authZ. The Idempotency-Key header is forwarded verbatim by
// proxyToGoBackend — required for the money-path Support and Play-Along POSTs.
//
// Auth boundary: member + admin calls require a user (requireRequestUser). But a
// handful of GETs are PUBLIC (competition catalogue/detail, Merit leaderboard,
// pot transparency, credential verify) and must work WITHOUT a bearer token, so
// we forward those unauthenticated. Everything else is authed at the edge; Go
// still re-checks authZ.

// Returns true when the (method, subpath) pair is a public, no-auth Arena GET.
function isPublicArenaGet(method: string, sub: string): boolean {
  if (method !== 'GET') return false;
  // GET /api/arena/competitions
  if (sub === 'competitions') return true;
  // GET /api/arena/competitions/{id}
  if (/^competitions\/[^/]+$/.test(sub)) return true;
  // GET /api/arena/competitions/{id}/leaderboard/merit
  if (/^competitions\/[^/]+\/leaderboard\/merit$/.test(sub)) return true;
  // GET /api/arena/competitions/{id}/pot
  if (/^competitions\/[^/]+\/pot$/.test(sub)) return true;
  // GET /api/arena/credentials/{hash}/verify
  if (/^credentials\/[^/]+\/verify$/.test(sub)) return true;
  return false;
}

async function forward(request: Request, path: string[]) {
  try {
    const sub = (path ?? []).join('/');
    // Public GETs skip the user requirement; everything else must be authenticated.
    if (!isPublicArenaGet(request.method, sub)) {
      await requireRequestUser(request);
    }
    return proxyToGoBackend(request, `/api/arena/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
