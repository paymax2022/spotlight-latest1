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

## Consequences
- With a traffic-aware maps provider, the trip duration feeds the fare and routes are cached for
  only 90s, so a 409 can occur without any pricing change. This fails closed: the app re-quotes and
  the second tap succeeds. The proper fix is to freeze the estimate's route and config, as
  card-direct does.
- Pre-existing and unchanged: a same-key wallet retry with an unchanged fare still fails at the
  parcel insert rather than returning the booking. No double charge occurs.
