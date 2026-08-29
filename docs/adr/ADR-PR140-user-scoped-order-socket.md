# ADR-PR140 — The merchant order queue subscribes to the user, not to an order

**Status:** Accepted
**Date:** 2026-08-29
**Deciders:** Restaurant & Delivery module

> Written with the `ADR-PR140` placeholder per `docs/adr/ADR-000-template.md`.
> **140 is not a real pull request.** This work landed by direct push to
> `develop` (commits `e47f45d7`…`b45a9e8f`), so no PR number exists to name it
> after. The placeholder is only a unique sort-and-rewrite token for
> `adr-assign.yml`, which allocates the real number on push; 140 was chosen
> because it follows 139, the last placeholder the repo used, so this ADR and its
> sibling `ADR-PR141` are numbered in the order they were written.

## Context

The merchant order queue (`app/food/restaurant/index.tsx`) refreshed by polling
every 6 seconds. The event a restaurant most needs is a **new order**, so up to
six seconds could pass between a customer paying and the kitchen being told.

Realtime already existed, and the queue could not use it. `useOrderRealtime`
opens a socket for one order and discards every frame whose `order_id` is not
that order:

```ts
case 'order.status':
  if (frame.payload.order_id === orderId) setLiveStatus(frame.payload.status);
```

That is exactly wrong for this screen. Subscribing per-order requires an order
id, and the order a merchant needs to hear about is by definition one they have
not been told about yet. There is no id to subscribe with.

The obvious reading is that the module needs a new per-restaurant fan-out. It
does not, and that is the whole point of this decision.

**The hub is keyed by user id, not by order.** `Realtime.publish` resolves an
order's participants and pushes to each one individually:

```go
recips := r.recipients(ctx, orderID)   // customer, owner, rider
for _, uid := range recips {
    r.hub.SendToUser(uid, msg)
}
```

and `ServeOrderWS` registers the connection under the caller, not the order:

```go
ok, _, err := h.svc.isParticipant(c.Request.Context(), c.Param("orderId"), uid)
...
_ = h.hub.ServeHTTP(c.Writer, c.Request, uid)
```

So `:orderId` is an **authorization gate, not a subscription filter**. A merchant
already connected for order X was, at the socket level, receiving frames for
brand-new order Y the moment it was placed — `PlaceOrder` broadcasts
(`service.go`, `broadcastStatus(order.ID, OrderPending)`) and `orderParties`
resolves the restaurant's `owner_id`. The client was throwing those frames away.

## Decision

**1. Add a user-scoped socket: `GET /api/finance/restaurant/ws`.**

It drops the order gate and keeps the identity. Everything else — the hub, the
fan-out, the frame types — is unchanged.

This cannot widen what anyone sees. `SendToUser(uid, …)` only ever delivers
frames already destined for that user, so the socket carries exactly the caller's
own events. It is **strictly narrower** than what an order-scoped socket already
hands out, because it adds no participant check to pass and grants no access the
holder did not already have.

**2. Separate ticket scopes with a reserved `order_id` of `"*"`.**

`WS_TICKET_SIGNING_SECRET`-signed tickets already bind to an order. A user-scoped
ticket reuses the identical signing scheme with `order_id: "*"`. No change to the
HMAC, the payload shape, or `validateWSTicket`'s crypto.

Real order ids are UUIDs, so `"*"` cannot collide, and the validator compares
`order_id` for exact equality. The scopes are therefore separated **by
construction**: an order ticket cannot be replayed on the user socket, nor the
reverse. Verified against the running backend:

| Ticket | Endpoint | Result |
|---|---|---|
| valid, scope `"*"` | `/restaurant/ws` | **426 Upgrade Required** — auth passed, reached the WS upgrade |
| valid, scope `"*"` | `/orders/:id/ws` | 401 |
| valid, scope `<order-id>` | `/restaurant/ws` | 401 |
| expired, scope `"*"` | `/restaurant/ws` | 401 |
| tampered payload | `/restaurant/ws` | 401 |
| absent | `/restaurant/ws` | 401 |

**3. The client invalidates queries; it does not decode frames into list state.**

`useRestaurantQueueRealtime` treats a frame as "something changed, go and ask"
rather than as data. React Query refetches through the normal authenticated path,
so the list stays the single source of truth and a socket payload can never paint
an order the server would not have returned. It also resyncs on reconnect, since
a socket that was down may have missed events.

**4. Polling becomes a safety net, not the mechanism.** 6s while the socket is
down or under mock, backing off to 60s while it is up. Not zero: a merchant
silently missing an order is the worst failure this screen has, and a dropped
frame must not be able to cause it.

## Consequences

### Positive
- New orders reach the kitchen as fast as the broadcast, instead of up to 6s late.
- No new fan-out, no new frame types, no per-restaurant channel to keep correct.
- Removes a class of bug rather than adding a feature: the queue no longer needs
  to know an order exists before it can hear about it.
- Poll traffic on an idle connected merchant drops 10×.

### Negative / trade-offs
- A second realtime hook alongside `useOrderRealtime`. They genuinely differ —
  one filters to a single order and decodes state, the other spans all of the
  caller's orders and only invalidates — but a reader must now pick correctly.
- Frame-driven invalidation costs a refetch per event. Cheap next to
  reconstructing a list from frames, and it is what keeps the server
  authoritative, but it is not free under a burst.
- `"*"` is a sentinel in a field otherwise holding UUIDs. Safe, and asserted, but
  it is a special case someone must notice.

### Risks
- **`WS_TICKET_SIGNING_SECRET` was set nowhere.** It appeared only in
  `.env*.example`. The minter fails closed, so live order tracking had been
  silently degrading to polling in local dev **all along — including the
  pre-existing customer rider-tracking socket**, which is why nobody noticed. A
  matching dev value is now set in `backend/.env` and `frontend-web/.env.local`
  (both gitignored). **Staging and production need a real matching value in both
  processes**, or realtime is dead there too and merely looks quiet.
- A merchant with many concurrent orders receives every frame for all of them.
  Fine at current volumes; if it ever is not, the fix is server-side filtering by
  frame type, not a narrower socket.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Per-restaurant WS channel | Requires new fan-out, a new subscription key, and a second authorization model. The hub is already user-keyed, so this would add a concept to solve a problem that does not exist. |
| One socket per order in the queue | N sockets per merchant, and still cannot deliver the one event that matters — a new order has no socket yet. |
| Anchor a socket on any existing order the merchant participates in | Works, needs no backend change, but leaves a merchant with zero orders unable to connect at all — precisely the first-order case. Also abuses the order gate to mean something it does not. |
| Server-Sent Events | A second transport for one screen, when a working WS hub with cross-instance Redis fan-out already exists. |
| Shorten the poll to 1–2s | Multiplies load on every merchant device to shave latency that realtime removes entirely, and still loses to a socket. |
| Reuse `ServeOrderWS` with `orderId="*"` | Overloads a route whose contract is "you are a participant of this order" with one that means "you are you". A separate route keeps each authorization rule readable. |

## Related

- `backend/internal/restaurant/handler_delivery.go` — `ServeUserWS`
- `backend/internal/restaurant/ws_ticket.go` — `WSScopeUser`
- `backend/internal/restaurant/ws_tracking.go` — the user-keyed hub this relies on
- `frontend-web/src/lib/restaurant/ws-ticket.ts` — `buildUserWsTicket`
- `mobile-app/reactnative/src/features/food/useRestaurantQueueRealtime.ts`
- Sibling: ADR-PR141 (rider status in SQL)
