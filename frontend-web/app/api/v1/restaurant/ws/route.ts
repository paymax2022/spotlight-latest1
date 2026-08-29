import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { buildUserWsTicket } from '@/src/lib/restaurant/ws-ticket';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';

// GET /api/v1/restaurant/ws — a short-lived signed ws(s):// URL for the CALLER'S
// OWN realtime stream, pointing directly at the Go backend.
//
// Sibling of the per-order ticket handled inside orders/[...path]/route.ts, and
// it exists for the same reason (this Next proxy is fetch-based and cannot
// upgrade a WebSocket — see ws-ticket.ts for the full decision record). The
// difference is scope: the merchant order queue cannot subscribe per-order to an
// order it has not yet been told about, which is what kept it polling.
//
// A static `ws` segment, so it resolves ahead of the sibling [id] route rather
// than being treated as a restaurant whose id is "ws" — the same reason ./mine
// is explicit.
export async function GET(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    const user = await requireRequestUser(request);
    const { url, expiresAt } = buildUserWsTicket(user.id);
    return successResponse({ url, expiresAt });
  } catch (err) { return handleApiError(err); }
}
