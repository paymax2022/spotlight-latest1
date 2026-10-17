# ADR-PR836: Parcel insurance is an opt-in tick paid at booking

**Status:** Accepted · **Date:** 2026-10-17 · **Area:** transport / insurance money path · **Flag:** `FEATURE_PARCEL_PREPAID_INSURANCE`

## Context
Before this change, parcel Goods-in-Transit cover worked like this:
- At booking it was display-only: an indicative premium was shown and never charged.
- At courier accept it was bound and charged as a separate wallet debit. MyCover's quote needs the courier's vehicle plate, which doesn't exist before then.
- Entering a declared value implied the sender wanted cover.

The product owner wants insurance to be **optional (an explicit tick)** and **paid at booking together with the fare**, tracked in the insurance module.

## Decision
1. **What the customer pays.**
   - `insure: true` charges the estimate's premium at booking: catalog rate × declared value, floored at the insurer minimum.
   - The customer pays exactly that. **The platform absorbs** any difference to the insurer's real premium at bind (`paymax_revenue` ↔ `provider_clearing`, posted only after a successful bind).
2. **Where the premium sits.**
   - It is held in a new standing account, `insurance_premium_hold`, and **never** enters the fare escrow or the courier settlement.
   - At courier accept, `policy.BindFromQuotePrepaid` (the existing saga, with only the premium step swapped) moves it hold → clearing and binds.
3. **Refunds.**
   - If cover can't be bound, the premium is refunded to the wallet and the customer is told.
   - If the parcel is cancelled **before or after** the bind, the premium is refunded, and a bound policy is cancelled. After a bind the refund is a platform cost, so clearing still owes the insurer.
   - Ineligible bookings are refused **before any money moves**: no declared value, an incomplete sender profile, a wallet that can't cover fare + premium, or the card rail.
4. **Money keys are deterministic and the ledger is the source of truth.**
   - Every refund from the hold uses one key per booking (`<bookingKey>:insurance_refund`), so a premium can never be refunded twice.
   - A same-key retry after a crash reuses the held premium.
   - Where the money is after a failure is read from the ledger, never inferred from an error.
5. **State.** `parcels.insurance_status` holds `none | declined | held | binding | bound | refunded | refund_failed`. Transitions are claimed atomically.
6. **Recovery.** `ReconcileParcelInsurance` runs on the stuck-settlement ticker after a grace period and resolves anything a crash leaves in between.
   - For a premium already with the insurer, it uses the insurer's recorded bind outcome: refused or never sent means refund; bound means record the cover; unknown is left for a human.
7. **Legacy parcels.** Parcels booked before the flag (`none` + declared value) keep the legacy bind-and-debit at accept. New unticked bookings are `declined`.
8. **The ledger account-type CHECK is widened from the live constraint** as `(existing) OR new`, not as a re-listed array. Other branches widen the same CHECK, so a re-listed array silently drops their types.

## Consequences
- **Price risk:** the platform carries the gap between the premium shown and the insurer's real price. That is the product owner's choice.
- **Card payments:** card-direct parcel checkout cannot include the premium yet (422). A follow-up PR adds the premium to the card charge and its split.
- **App:** a follow-up PR adds the tick-box, shows fare + premium, and gets a new booking key on `IDEMPOTENCY_KEY_CONFLICT`. That conflict is returned when a booking key's premium was already refunded.
- **Notifications:** customer notices use the transport notifier, which is log-only today. The app must surface `insuranceStatus` until push exists.
- **Residual race:** a retry landing exactly at the orphan sweep's grace boundary, plus an accept within milliseconds, could bind cover on a refunded premium. A re-check and a bind-time guard narrow it but do not eliminate it. Platform exposure is one premium.
