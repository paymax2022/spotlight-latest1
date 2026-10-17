# ADR-PR823: Wallet parcel booking pins the fare the customer saw

**Status:** Accepted · **Date:** 2026-10-17 · **Area:** transport / parcel money path

## Context
The wallet parcel booking prices again at book time. Pricing config, and since #817 an
admin-editable rate card, can change between the estimate the customer confirmed and the Book
tap. When that happened, the wallet escrowed a different amount without telling the customer.
The card-direct rail already freezes its quote and checks the collected amount.

## Decision
1. `POST /mobility/parcels` accepts an optional integer `expected_fare_kobo`. This is the estimate's
   `fareKobo`, not `totalKobo`, because the escrow is fare-only and the insurance premium is
   indicative.
2. On the wallet path, a value that differs from the live fare in any direction is refused with
   **409 `FARE_CHANGED`**. The response carries the live `fare_kobo`. The check runs before the tier
   gate and before the escrow, so nothing moves. It is exact equality: the customer is always
   escrowed exactly the amount they confirmed.
3. **Optional, not required.** Older app builds and scheduled dispatch (no customer present) do not
   send it, and they keep today's behaviour. Making it required needs a minimum-app-version gate, and
   scheduled dispatch would need its own answer. That is left for later.
4. A mismatch on an Idempotency-Key that has already booked for this sender returns that booking.
   Otherwise a retry after a lost response would be told "not charged" while it was charged.
5. The card-direct rail ignores the field. It is already pinned by its frozen quote.

6. **Route token.** The estimate returns `routeToken`: an HMAC-SHA256 signature over pickup, dropoff,
   route distance, route duration and a 15-minute expiry, keyed by `PARCEL_ROUTE_TOKEN_SECRET` (at
   least 32 bytes; unset turns tokens off). A booking that sends it back prices from **that route**
   and the **live** pricing config. A traffic-driven duration change therefore cannot cause
   `FARE_CHANGED`, while a real price change still does. A token that does not verify is ignored
   and the route is fetched live; it is never trusted. The route is server-computed, so freezing it
   gives the client no lever. This mirrors card-direct's frozen quote, except that the config is
   *not* frozen: the wallet charge must reflect today's price. Tokens are honoured on the wallet
   path only. Card-direct quotes strip them so a card payer cannot pick the cheapest of several
   estimates.
7. **Idempotency replay for every path.** A repeat of a key that already booked for this sender
   returns that parcel before pricing, the tier gate and the escrow. Previously only card-direct did
   this, and a wallet retry with an unchanged fare failed at the parcel INSERT. If a concurrent
   same-key request loses the INSERT, it returns the winner's parcel; the escrow is idempotent on
   the key. On the wallet path the reused key must carry the same booking (pickup, dropoff,
   receiver phone, size, speed). A different booking gets 409 `IDEMPOTENCY_KEY_CONFLICT`. The app
   keeps one key per booking (`parcelBookingKey.ts`) instead of one per tap, so a retry after a
   lost response is a true replay rather than a second debit.
8. **The payment sheet shows the real debit.** The app's sheet amount and spend-limit check use
   `fareKobo`, not `totalKobo`. The indicative insurance premium is not charged at booking.

## Consequences
- Production needs `PARCEL_ROUTE_TOKEN_SECRET` set (`openssl rand -hex 32`). Without it,
  behaviour is the pre-token one: a traffic-aware provider can cause a false `FARE_CHANGED`. That
  fails closed, and the second tap succeeds after the re-quote.
- Rotating the secret invalidates outstanding tokens. Those bookings fall back to a live route, so a
  rotation costs at most a few re-quotes.
- `expected_fare_kobo` stays optional (older apps, scheduled dispatch). Making it required needs a
  minimum-app-version gate.
