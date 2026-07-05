import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Catch-all proxy: /api/v1/telemedicine/<...> → Go /api/v1/telemedicine/<...>.
// No matching feature flag exists, so the flag check is intentionally omitted —
// Go enforces flags/authZ, appointment ownership + the ledger invariants.
// Money mutations forward the Idempotency-Key.
//
// This coexists with the more specific static routes already under
// app/api/v1/telemedicine/{appointments,doctors}/** (Next.js prefers the more
// specific route when both match); this catch-all only picks up the sub-paths
// those don't cover (specialties, doctors/:id, doctors/:id/availability,
// doctors/:id/reviews, appointments/:id/summary, appointments/:id/confirm,
// appointments/:id/reschedule, appointments/:id/cancel, appointments/:id/review,
// appointments/:id/prescription GET-back, doctor/* dashboard endpoints).
async function forward(request: Request, path: string[]) {
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/v1/telemedicine/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
