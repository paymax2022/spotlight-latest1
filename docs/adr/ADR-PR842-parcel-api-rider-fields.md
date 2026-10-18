# ADR-PR842: What the parcel API tells the sender and the courier

**Status:** Accepted · **Date:** 2026-10-18 · **Area:** transport / parcel API · **Flag:** none new (courier routes sit in the existing transport-modes group)

## Context
A customer + rider end-to-end run (`TestLiveDB_ParcelCustomerAndRiderEndToEnd`, PR #841) showed the parcel API lacked what the apps render:
- no courier details or coordinates on the parcel;
- no pay figure on rider requests;
- no rider history or earnings;
- a raw validator message when proof of delivery is missing.

The mobile app's mocks had hidden this.

## Decision
1. **Additive only.** Existing keys stay (`status`, `pickupAddress`, `courierId`, …). New nested `pickup`/`dropoff` places and a `courier` object sit beside them, so older clients keep working.
2. **The sender sees the courier's phone masked** (`••••` + last 4 digits). The raw number is never returned. Contact goes through the app, and the number is only for recognising a call.
3. **PINs are returned only while the parcel is live.** They're dropped once it is `delivered`, `cancelled` or `failed`, since there's nothing left to unlock. They remain sender-only.
4. **A rider's quoted pay is computed by the function that pays.** `estCourierNetKobo` runs the courier's commission tier through `settlement.ComputeLegs`, never a hardcoded 80%. The end-to-end test asserts the quote equals the settled credit.
5. **Rider earnings are the settled provider leg** (`settlements.provider_kobo` once `settled`). That's what reached the wallet, not a client-side fare × share.
6. **`deliveredAt` comes from the `parcel.delivered` audit event.** There is no `delivered_at` column, and `updated_at` moves on later writes. This keeps the change free of a migration.
7. **A missing `proof_url` is the service's 422 `PROOF_REQUIRED`.** The binding tag is removed so validation doesn't answer first with an internal field path.

## Consequences
- Detail and history do a few extra indexed reads (courier, settlement, rating and audit lookups). That's acceptable at parcel volumes; if needed, add a `delivered_at` column later via an additive migration.
- The mobile app still has to map these shapes (`status` → `phase` and so on). That's the follow-up app session.
- **Not done here:** sending the drop-off PIN to the receiver (today the sender relays it). That's a product decision.
