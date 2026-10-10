import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/loyalty/<...> → Go /api/finance/loyalty/<...>
// transitions, ledger/idempotency and the NL-1..12 invariants. Admin routes hit
// Go directly. Money mutations forward the Idempotency-Key.
//
// The Go backend now REQUIRES Idempotency-Key on every redeem (iron rule — a
// replay must never double-debit points). The BFF is the edge: when a caller
// omits the header we synthesize one per submit (crypto.randomUUID) and forward
// it; dedupe still happens at the backend. A caller-supplied key is forwarded
// verbatim by the proxy so its own retries collapse onto one redemption.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function forward(request: Request, path: string[]) {
  if (!featureFlags.loyalty()) return errorResponse('This service is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    const canonical = (request.headers.get('Idempotency-Key') ?? '').trim();
    const alt = (request.headers.get('X-Idempotency-Key') ?? '').trim();
    // Canonical key flows verbatim via proxyToGoBackend; an X- spelling is
    // mapped onto it so the caller's dedupe still engages; absent both, the
    // edge synthesizes a fresh key per submit.
    const options =
      MUTATING_METHODS.has(request.method) && canonical === ''
        ? { headers: { 'Idempotency-Key': alt || crypto.randomUUID() } }
        : undefined;
    return proxyToGoBackend(request, `/api/finance/loyalty/${sub}`, options);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function HEAD(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
