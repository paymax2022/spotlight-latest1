// ── Restaurant & Delivery — live-order WebSocket ticket minting ──────────────
//
// WHY A SIGNED-TICKET ENDPOINT INSTEAD OF A RAW WS UPGRADE (decision record):
//   The RN food app opens a live-tracking socket at
//     {API_BASE}/api/finance/restaurant/orders/:id/ws
//   pointed (in prod) at this Next.js app. The shared HTTP proxy
//   (src/lib/go-backend.ts → proxyToGoBackend) is `fetch`-based and CANNOT
//   upgrade a connection to WebSocket. Performing the upgrade in a route handler
//   ("option a") is not viable in THIS deployment:
//     • App-Router route handlers run on the Web Request/Response model; the Node
//       runtime exposes no `WebSocketPair`/upgrade primitive.
//     • Production runs Next via `frontend-web/server.js` (plain http.createServer
//       + Next's request handler) on cPanel Passenger, with NO `upgrade` event
//       wired up — a hand-rolled upgrade would never be reached.
//
//   APPROACH (b) — chosen: an authenticated endpoint returns a SHORT-LIVED,
//   HMAC-SIGNED ws(s):// URL pointing DIRECTLY at the Go backend WS endpoint.
//   The Go backend natively handles the upgrade; the signed token (carried in
//   the `?ticket=` query, because browser/RN WebSocket constructors cannot
//   reliably set Authorization headers across a proxy hop) proves the caller was
//   authenticated for THIS order. The ticket is opaque and expires quickly, so
//   it cannot be replayed or shared long-term. The Go backend validates it out
//   of band using the shared WS_TICKET_SIGNING_SECRET.
//
//   This helper is invoked from the existing restaurant orders catch-all proxy
//   (app/api/v1/restaurant/orders/[...path]/route.ts) when the sub-path is
//   `<orderId>/ws`. A sibling `[id]/ws` route cannot coexist with the catch-all
//   `[...path]` segment (Next.js forbids two different dynamic slug names at the
//   same level), so the ticket logic lives here and the catch-all delegates.

import { createHmac, randomBytes } from 'crypto';

// Direct Go backend WS origin. Prefer an explicit ws(s):// override; otherwise
// derive it from the HTTP base by swapping the scheme (http→ws, https→wss).
function goBackendWsBase(): string {
  const explicit = process.env.GO_BACKEND_WS_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const http = process.env.GO_BACKEND_URL || 'http://localhost:8080';
  return http.replace(/^http/, 'ws').replace(/\/$/, '');
}

// Short-lived signed ticket: base64url(payload).hmacSHA256(payload). The Go
// backend recomputes the HMAC with the same secret and checks `exp`.
function signTicket(orderId: string, userId: string): { ticket: string; expiresAt: number } {
  const secret = process.env.WS_TICKET_SIGNING_SECRET;
  if (!secret) {
    // Fail closed — never hand out an unsigned/forgeable ticket in production.
    throw new Error('WS_TICKET_SIGNING_SECRET is not configured');
  }
  const ttlSeconds = Number(process.env.WS_TICKET_TTL_SECONDS || '60');
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = {
    sub: userId,
    order_id: orderId,
    exp: expiresAt,
    nonce: randomBytes(8).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return { ticket: `${encoded}.${sig}`, expiresAt };
}

/**
 * Build the signed, direct-to-backend WebSocket URL for an order.
 * The caller MUST have already authenticated the user (requireRequestUser).
 */
export function buildOrderWsTicket(
  orderId: string,
  userId: string,
): { url: string; expiresAt: number } {
  const { ticket, expiresAt } = signTicket(orderId, userId);
  const url =
    `${goBackendWsBase()}/api/finance/restaurant/orders/${encodeURIComponent(orderId)}/ws` +
    `?ticket=${encodeURIComponent(ticket)}`;
  return { url, expiresAt };
}
