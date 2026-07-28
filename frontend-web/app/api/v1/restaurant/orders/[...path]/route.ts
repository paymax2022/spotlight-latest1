import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { buildOrderWsTicket } from '@/src/lib/restaurant/ws-ticket';

// Catch-all proxy: /api/v1/restaurant/orders/<...> → Go /api/finance/restaurant/orders/<...>.
// Covers the order lifecycle the mobile food client drives off the bare /orders
// namespace (get/list, dispatch, rate, messages, assign/accept/pickup/handoff,
// location). Static "orders" segment so it coexists with restaurant/[id]/*.
// Money mutations forward the Idempotency-Key.
async function forward(request: Request, path: string[]) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    const sub = (path ?? []).join('/');
    return proxyToGoBackend(request, `/api/finance/restaurant/orders/${sub}`);
  } catch (err) { return handleApiError(err); }
}
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  // Live-order tracking ticket: GET /api/v1/restaurant/orders/:id/ws.
  // The Next.js HTTP proxy cannot upgrade WebSockets, so instead of proxying we
  // return a short-lived signed ws(s):// URL that points DIRECTLY at the Go
  // backend WS endpoint. Auth is enforced (requireRequestUser); see ws-ticket.ts
  // for the full decision record. The catch-all owns this segment because a
  // sibling [id]/ws route cannot coexist with [...path] in Next.js.
  if (Array.isArray(path) && path.length === 2 && path[1] === 'ws') {
    if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
    try {
      const user = await requireRequestUser(request);
      const orderId = path[0];
      if (!orderId) return errorResponse('Missing order id.', 400);
      const { url, expiresAt } = buildOrderWsTicket(orderId, user.id);
      return successResponse({ url, expiresAt });
    } catch (err) { return handleApiError(err); }
  }
  return forward(request, path);
}
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) { const { path } = await ctx.params; return forward(request, path); }
