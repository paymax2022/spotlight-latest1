# ADR-030 — Post-settlement dispute refunds: the tip is rider-funded, not platform-funded

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Product owner (money policy) + Restaurant/Delivery
**Scope:** `backend/internal/restaurant` (`disputes.go`, `disputes_service.go`, new
`tip_clawback.go`, the `settleOrder` recovery hook) and one additive migration
(`supabase/migrations/20261205000000_restaurant_dispute_tip_clawback.sql`). No API contract change.

## Context

PR #96 made the customer tip real on the food-delivery money path: `PlaceOrder` had been
silently discarding `req.TipKobo`, so the tip was never escrowed and never paid. It is now
added to the escrowed `orders.total_kobo` at placement and paid **100% to the rider** at
settlement (`settlement.Split.TipKobo` — the 80/10/10 percentages price the non-tip base, so
neither the restaurant nor the platform takes a cut of it).

That closed one gap and opened another, on a path PR #96 did not touch.

`AdminResolveFoodDispute` (`disputes_service.go`) read `total_kobo` — now tip-inclusive —
and passed it to `foodRefundKobo`, which returns the **whole order total** for
`FoodRefundFull`. The refund is funded by crediting the customer from
`AccountPaymaxRevenue`. Critically, food disputes resolve **only on `DELIVERED` orders**
(`disputes_service.go:43`), which means settlement has **already paid the rider the tip in
full**, and this path has no provider or rider clawback at all.

So a full refund on a tipped order had the platform refunding a tip it never held. On a
₦10,000 order with a ₦500 tip:

```
total        1,066,285 kobo  (subtotal 900,000 + delivery 116,285 + tip 50,000)
settlement:  base = total − tip = 1,016,285
             platform  101,628   rider  101,628 + 50,000 tip   restaurant  813,029
dispute (refund_full):  platform credits the customer 1,066,285
net platform position:  +101,628 − 1,066,285 = −964,657
```

The `−50,000` inside that is pure leakage: money the platform never received, paid out to
make the customer whole, while the rider keeps the tip for a delivery that was disputed and
upheld.

The locked project rule — *"post-settlement dispute refunds are platform-funded, no provider
clawback"* — predates tips. It was written when every kobo of the order total flowed through
the platform's own 80/10/10 split, so "platform-funded" and "refund the total" were the same
statement. A tip breaks that equivalence: it is the one leg that passes straight through to a
third party.

This is distinct from the **cancel / reject / dispatch_failed** path, which goes through
`settlement.Refund` and returns the true escrowed total (tips included automatically, since
the escrow is still held and the rider has not been paid). That path is correct as-is and is
covered by `TestLiveDB_OrderTipRefundedOnCancel`. Nothing here changes it.

### Options considered

- **(a) Cap the refund at `total − tip`.** The platform never refunds money it never held.
  Simple, no new machinery. But the customer is made whole only on food + delivery and is
  left having paid a tip for a delivery they disputed and won.
- **(b) Accept the exposure as goodwill and document it.** Customer fully whole, platform
  absorbs the tip, rider keeps it. Zero implementation cost, but it makes every upheld
  dispute on a tipped order a guaranteed loss on money the platform never touched, and the
  leak scales with tip adoption.
- **(c) Refund the full tip-inclusive total AND claw the tip back from the rider.** Most
  ledger-correct — customer whole, platform exposure unchanged from the pre-tip world, and
  the tip follows the failed delivery. Requires a reversal path plus a negative-balance
  policy for a rider who has already withdrawn.

## Decision

**Option (c), with a deferred-recovery variant of the negative-balance policy chosen by the
product owner.** The rider's wallet is **never driven negative**; an unaffordable clawback is
queued and recovered from the rider's next delivery settlement.

Concretely:

1. **The platform-funded refund is computed on the non-tip basis.**
   `platformRefundableKobo(total, tip) = total − tip` (failing closed to `0` if the two have
   diverged such that `tip >= total`). This basis is passed to `foodRefundKobo` and therefore
   binds **both** branches — see *Consequences* for why that is not optional.

2. **On `refund_full` with a tip and a rider, the tip is clawed back from the rider** and
   passed to the customer as a single balanced pair — `DR rider wallet → CR customer wallet` —
   posted via `ledger.Debit` with the customer's wallet as the counterparty account.
   `Debit` performs the sufficiency check and the insert atomically under the rider's advisory
   lock, so the wallet can never be overdrawn.

3. **When the rider's wallet cannot cover it**, the obligation is recorded as `pending` in
   `restaurant_dispute_tip_clawbacks` (keyed by dispute id) and recovered by a sweep that runs
   at the end of `settleOrder` — the moment the rider has just been paid and their balance is
   at its high-water mark. The disputing customer is credited when that recovery lands.

4. **The customer therefore receives `total − tip` at resolution and the tip when the rider
   funds it.** The platform fronts nothing. This is the explicit trade the product owner
   accepted: the customer waits for the tip portion, and does not receive it at all if the
   rider never delivers again. In exchange the platform carries no tip exposure on any
   disputed order, recoverable or not.

5. **The clawback does NOT fire on `refund_partial`.** A partial refund is characteristically
   a *kitchen* fault (`wrong_item`, quality, missing items), and taking a rider's tip for the
   restaurant's mistake is indefensible. Partials remain purely platform-funded — and remain
   bounded by the non-tip basis, so this exemption cannot be used to refund the tip by another
   route.

### Why not (a) or (b)

**(b)** was rejected because it converts a bug into a standing subsidy. The exposure is
unbounded in aggregate: it grows linearly with tip adoption, and it is largest exactly where
disputes are most likely (non-delivery), because a customer who tips generously and receives
nothing is the paradigm upheld dispute.

**(a)** was rejected because it silently transfers the loss to the customer. The tip is
consideration for a delivery; when the platform itself rules the delivery did not happen, the
customer keeping no remedy for the tip is the wrong resting place for that money. (a) is
nonetheless the *fallback behaviour* of this decision — when there is no rider on the order,
or the rider never earns again, the outcome is exactly (a).

## Consequences

**The partial branch had to move with the full branch.** `foodRefundKobo`'s partial branch
bounds `requestedKobo` against the basis it is handed (`0 < requested < basis`). Capping only
`refund_full` would have left `refund_partial` able to refund up to `total − 1` — i.e. the
entire tip, one resolution at a time — making the "loophole" strictly worse than the bug,
because it would be reachable through the ordinary ops UI with no code change. Both branches
now derive from `platformRefundableKobo`. This is locked by
`TestFoodRefundPartialInheritsTipCap` (pure) and
`TestLiveDB_DisputePartialRefundInheritsTipCap` (live).

**`ErrDuplicate` from `ledger.Debit` is not proof that money moved.** `Debit` takes the Redis
idempotency lock *before* its balance check, so an attempt that fails on insufficient funds
leaves that lock held for its 10s TTL; a retry inside that window reports duplicate having
posted nothing. Since the recovery path deliberately reuses one idempotency key per dispute
(so a debt can produce at most one ledger pair however often it is re-driven), it resolves
`ErrDuplicate` against `ledger.Posted`, which reads the credit side from the ledger of record
and is Redis-independent. Only a durable entry discharges a debt.

**Write ordering is inverted relative to the refund path.** The refund path posts money first
and records second, so a record can never claim a refund that did not move. The clawback
records first and moves second, because here the row is the **debt**, not the receipt: a crash
after a successful debit leaves a pending row whose ledger pair already exists, which the next
sweep resolves through `Posted` and stamps correctly, whereas a crash the other way round
would silently forget the obligation — the one outcome with no recovery.

**Recovery is all-or-nothing per debt.** A debt is discharged only when the rider's wallet
covers it in full. Balances accumulate across deliveries, so a rider whose single next payout
is smaller than the tip still converges, just over several deliveries. This keeps each debt to
exactly one ledger pair under one idempotency key, which a part-paid debt could not be.

**The recovery sweep must never fail a settlement.** It runs after `settlement.Settle` has
committed, so every error inside it is logged and swallowed. Anything not recovered on one
pass stays pending for the next.

**Net platform position after this change** (same example): `+101,628 − 1,016,285 = −914,657`,
with the ₦500 tip recovered from the rider rather than absorbed. The platform's remaining
exposure — the 90% of the order it pays back but never kept — is the pre-existing,
deliberately accepted "platform-funded, no provider clawback" rule, which this ADR does not
revisit.

**Ops visibility.** `restaurant_dispute_tip_clawbacks` is the queue of outstanding rider debt.
A row `pending` for a long time means a rider who took a tip on a repudiated delivery and has
not delivered since; that is a collections/eligibility question, not a ledger one, and is
deliberately left out of scope here.

## Verification

Live-DB (`backend/internal/restaurant/dispute_tip_live_db_test.go`, `TestLiveDB_*` style,
gated on `TEST_DATABASE_URL`) — all three fail on the pre-change code and pass after:

- `TestLiveDB_DisputeFullRefundCapsPlatformAtNonTipBasis` — places a tipped order, delivers it
  (settling the tip to the rider), resolves `refund_full`, and asserts the platform revenue
  delta is exactly `total − tip`, the rider's wallet falls by exactly the tip, the customer is
  credited the full total across both legs, and a re-resolve moves no further money.
- `TestLiveDB_DisputePartialRefundInheritsTipCap` — every partial in the tip band
  `[basis, total)` is rejected and moves nothing; `basis − 1` is accepted and paid exactly;
  no rider clawback row is created.
- `TestLiveDB_DisputeTipClawbackDeferredToNextSettlement` — drains the rider's wallet, resolves
  `refund_full`, asserts the platform still pays only the basis (no backstop), the rider is not
  overdrawn, the debt is `pending`; then delivers a second order for that rider and asserts the
  sweep discharges the debt, credits the disputing customer the tip, and posts exactly one
  balanced pair `DR rider wallet / CR customer wallet` with no standing account in it.

Pure: `TestPlatformRefundableKobo`, `TestFoodRefundPartialInheritsTipCap`.
