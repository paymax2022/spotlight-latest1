# ADR-031 — Post-settlement dispute refunds: what may be refunded, and who funds it

**Date:** 2026-08-13
**Numbering:** ADR-030 is taken by PR #98 (wallet-plane double entry), which was itself
renumbered off 029 when PR #95 claimed that for the FX orch ledger. Three branches collided
on 029/030; check `docs/adr/` on the latest `develop` **and** the open PRs before claiming a
number. The gap at 030 in this branch's history is that collision, not an off-by-one.
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

5. **The platform-funded budget is capped per ORDER and is CUMULATIVE across its disputes.**
   `remainingRefundableKobo` subtracts what the order's other disputes have already drawn
   from `platformRefundableKobo(total, tip)`, and a resolution may only spend the remainder.
   A cumulative cap rather than a one-refund-per-order rule: a customer refunded ₦500 for a
   missing item who later establishes the whole order was wrong should still be able to be
   made whole — one-per-order would lock them out and ops would simply work around it. What
   can never happen is the total across an order's disputes exceeding what the platform took
   in. `refund_full` on an exhausted budget is rejected outright rather than silently paying
   zero; `replacement`/`dismissed` still resolve, so ops can always close a ticket.

6. **The clawback fires on the order ENDING UP fully refunded, not on the `refund_full`
   label.** Since the budget is cumulative, `refund_full` means "whatever is left" — after a
   1,016,284 partial it pays 1 kobo — so the label alone no longer implies the customer got
   the whole order back, and taking a third party's tip on the strength of it would be
   wrong. The gate is `res == FoodRefundFull && alreadyRefunded + refund >= orderCap`: the
   customer has been made whole on the entire non-tip basis. A zero-basis order satisfies it
   trivially, which is what keeps the tip recoverable there.

7. **The clawback does NOT fire on `refund_partial`.** A partial refund is characteristically
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

**Neither error `ledger.Debit` returns is proof about whether the pair exists**, so the
recovery path asks the ledger of record (`ledger.Posted`) *first*, before attempting
anything. `ErrDuplicate` is not proof it did post: `Debit` takes the Redis idempotency lock
before its balance check, so an attempt that failed on insufficient funds holds that lock for
its 10s TTL and a retry inside the window reports duplicate having posted nothing. Symmetrically,
`ErrInsufficientFunds` is not proof it did *not* post: `DebitWithBalanceCheck` runs the
sufficiency check **before** its `ON CONFLICT DO NOTHING` insert, so replaying an
already-posted clawback after the rider's balance has fallen below the tip returns
insufficient funds — and treating that as "not recovered" would strand the debt as pending
forever against a rider who had already paid, and re-notify the customer when a later sweep
finally cleared the check. `Posted` reads the credit side from the DB and is Redis-independent,
so it settles the question outright. This matters because the recovery path deliberately reuses
one idempotency key per dispute, so a debt produces at most one ledger pair however often it is
re-driven. (Both hazards generalise: **any** caller that retries a failed `ledger.Debit` under
the same key has them.)

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

**The clawback fires only on a tip the rider demonstrably RECEIVED.** `orders.tip_kobo`
records what the customer was *charged*, which is not the same as what the rider was *paid*,
and the two come apart in two reachable states. (i) When the escrow and the order total
diverge, `settleOrder` drops the tip leg and releases the tip through the percentages —
90/10 to restaurant/platform — while zeroing only its local variable, leaving
`orders.tip_kobo` nonzero. (ii) `transitionInternal` commits `status='delivered'` and only
then calls `settleOrder`, outside any transaction, so a settle failure leaves a delivered
order whose escrow is still held (the window the crash-recovery reconciler exists to close);
a dispute can be raised and resolved inside it. `riderWasPaidTip` therefore requires two things, and needs both: the settlement must be
`settled` with `settlements.total_kobo = orders.total_kobo` (the same predicate `settleOrder`
uses to decide whether to pay the tip leg — this establishes the tip was *in* the payout),
**and** the rider settlement leg `settle:<settlementID>:rider:credit` must exist on *this
rider's* wallet account (this establishes the *payee*). `orders.rider_id` is not evidence of
who was paid: `AcceptDelivery` guards only on there being no existing rider, not on order
status, so a rider can be attached to an already-settled order — one that settled through the
rider-less branch, which orphans the tip 90/10 to restaurant/platform. Amount alone would not
do either: a rider's plain percentage share can exceed a small tip, so `leg >= tip` proves
nothing. Where the gate fails, the outcome degrades to option (a): platform refunds the
basis, no clawback.

**The gate is re-checked before every debit, not only at recording time.** A debt can sit
pending for days, and the sweep is the last thing standing between it and a third party's
wallet, so `recoverRiderTipDebts` re-proves payment for each debt before drawing it down.
Nothing that changes about the order or its settlement in the interim can turn a queued debt
into a wrongful debit.

**Spending the budget is serialised per order, and backstopped in the DB.** Computing the
remainder and spending it must not interleave with another resolution on the same order —
two admins resolving two tickets concurrently would both read the same "already refunded"
figure and both pay out against it. `AdminResolveFoodDispute` therefore takes a
`pg_advisory_xact_lock` keyed on the order and holds it across read → compute → credit →
record, so the amount just spent is visible to the next resolver the moment it acquires the
lock. The lock spans the ledger credit, which runs on a second connection from the same
pool. No *lock-ordering* deadlock is possible — the ledger's advisory locks live in the
`wallet:` namespace, `Credit` takes none at all, and the clawback runs only after this tx
commits — but the nesting does hold one pooled connection while acquiring another, so enough
simultaneous resolves could exhaust the pool and stall until their contexts cancel. Dispute
resolution is a low-concurrency admin path and this mirrors the existing pattern in
`withdrawal.go`; the real fix is a tx-aware ledger credit so both legs share one transaction.

A constraint trigger on `restaurant_dispute_refunds` then makes the invariant true at the
storage layer, so a writer that forgets the lock — or any direct insert — still cannot
exceed the cap.

**The trigger takes that same advisory lock itself, and must.** A bare recompute-and-compare
is not a constraint: at READ COMMITTED two overlapping inserts for one order each see only
the committed rows plus their own, so both pass and the order lands over cap. This was not
theoretical — the first version of this trigger had exactly that hole, and
`TestLiveDB_DisputeRefundCapHoldsUnderConcurrency` reproduces it (2 of 2 inserts succeed,
cumulative 1,140,002 against a 950,000 cap) the moment the lock is removed. The lock is
re-entrant within a session, so the service path, which already holds it, is unaffected. The
two keys must be byte-identical, so the service lowercases the order id to match the
trigger's `lower(NEW.order_id::text)` — `orderID` comes from `disputes.reference` (TEXT),
whose casing is not guaranteed even though the FK lookup tolerates it.

**The trigger is gated on the new row actually moving money.** A zero-kobo row — a
`dismissed` or `replacement` resolution — can never push an order over its cap, and must be
insertable even on an order whose *historical* refunds already exceed it. Those legacy orders
are exactly what this change exists to stop growing, and ops still has to be able to close
their tickets; an ungated check would make the admin endpoint fail forever on precisely that
data. Deploying this needs a prior audit for such orders (query in the migration header):
money has already left on any that exist, and remediation is a product decision.

**The ledger, not the record table, is authoritative on a retry.** Because the budget is
derived from `restaurant_dispute_refunds`, a row that disagrees with the money silently
changes what is spendable. Two ways that could happen, both closed: `ledger.Credit` returning
`ErrDuplicate` is not proof it posted (the Redis idempotency lock is taken before the write,
10s TTL), so the resolve now confirms against the ledger and refuses to record a refund that
never moved; and a retry that resolves *differently* — a smaller partial, or `dismissed` —
would otherwise record a figure the ledger does not match, so when a credit already exists
under `dispute-refund:<disputeID>` its posted amount is used verbatim and the recomputation
is discarded.

**Uniqueness is per ORDER, not per dispute.** The shared `disputes` table blocks only a
concurrently *active* ticket on an order, and `orders.disputed_at` is a marker rather than a
gate — so once a dispute resolves, a second one is raisable on the same delivered order.
Keyed by dispute id alone, that second ticket would mint a fresh idempotency key and debit
the rider the same tip twice while crediting the customer twice. A unique index on
`order_id` is the hard guarantee; `recordTipClawback` inserts with an untargeted
`ON CONFLICT DO NOTHING` and reads back whether this dispute owns the clawback.

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

- `TestLiveDB_DisputeNoClawbackWhenRiderNeverPaidTip` — diverges the escrow so `settleOrder`
  drops the tip leg, then resolves `refund_full` and asserts the rider's wallet does not move
  and no clawback is queued.
- `TestLiveDB_DisputeTipClawedBackOnlyOncePerOrder` — resolves a full refund, then raises a
  SECOND dispute on the same delivered order: a second `refund_full` is rejected (no budget
  left), `dismissed` still closes the ticket, the rider is not debited twice, and the order
  has exactly one clawback row.
- `TestLiveDB_DisputeRefundBudgetIsCumulativePerOrder` — a ₦4,000 partial, then a second
  dispute: everything above the remainder is rejected (including amounts well under the
  order's own basis), `refund_full` pays exactly the remainder, platform revenue falls by
  exactly the basis across BOTH disputes rather than twice it, recorded refunds sum to the
  basis, a direct `INSERT` past the cap is rejected by the trigger with the service bypassed,
  and a zero-kobo `dismissed` row is still accepted on the exhausted order.
- `TestLiveDB_DisputeRefundCapHoldsUnderConcurrency` — two deliberately overlapping
  transactions each inserting 60% of the cap, with the first holding its transaction open
  across the second's insert. Exactly one may survive. Removing the trigger's advisory lock
  fails it 2-of-2 at 1,140,002 against a 950,000 cap; an earlier version of this test that
  merely started both goroutines together passed even against the broken trigger, because
  the two transactions serialised naturally — forcing the overlap is what makes it a guard.

Pure: `TestPlatformRefundableKobo`, `TestFoodRefundPartialInheritsTipCap`.

Each guard was confirmed to fail against the defect it covers: reverting the basis cap fails the
first three; dropping the `order_id` unique index fails the double-clawback test (rider debited
50,000 twice); bypassing `riderWasPaidTip` fails the never-paid test. Full
`internal/restaurant` + `internal/finance` + `backend/tests` suites green against a live DB.

## Known gaps (out of scope, deliberately)

- **Sub-case (b) declines a tip that is arguably still recoverable.** When an order is
  `delivered` but its settlement is still `escrowed`, the tip has not been paid to anyone —
  it is in escrow, and the reconciler will later pay it to the rider. The clawback declines
  outright there, so the customer permanently loses the tip in that window. Note this is a
  *different* justification from sub-case (a): in (a) debiting the rider would be an
  uncompensated third-party loss, whereas in (b) it is merely premature. Recording the debt
  as pending in (b) would be discharged automatically (the reconciler's `settleOrder` pays the
  rider and then runs the recovery sweep in the same call, and the sweep re-verifies payment
  before debiting). Not done here because it widens a money path for a narrow crash window —
  an admin must resolve a dispute inside the reconciler's grace period on an order whose
  settle failed.
- **The ticket-status gate is still read outside the refund lock.** The advisory lock closes
  the money-relevant race — two admins resolving *different* disputes on one order are now
  serialised, and the second sees the first's spend — but `foodDisputeResolvable` is checked
  before the lock is taken, so two admins can still both pass the gate on the *same* dispute
  with different resolutions. That is money-safe: the ledger credit is keyed
  `dispute-refund:<disputeID>` so the second is a duplicate no-op, and the record insert is
  `ON CONFLICT (dispute_id) DO NOTHING`. The residue is cosmetic — the loser's returned
  `FoodDispute` reports the amount it computed rather than the one actually recorded. The
  clean fix is to claim the ticket with a guarded `UPDATE ... WHERE status IN
  ('open','investigating')` and read the winning resolution back on conflict; not taken here
  because it is a wider refactor of the resolve path than this change warrants.
- **A crash between the commit and the ticket close leaves an open ticket with the refund
  already recorded and posted.** A retry converges — the record insert is a no-op, the budget
  read excludes this dispute so the amount recomputes identically, and the credit is
  idempotent — but until then `AdminListFoodDisputes` shows an open ticket whose money has
  already moved.
- **A long-`pending` clawback is a collections question, not a ledger one** — a rider who took a
  tip on a repudiated delivery and has not delivered since. No eligibility or dunning policy is
  defined here.
- **`recoverRiderTipDebts` has no `LIMIT`** and runs synchronously inside the delivery status
  flip, one ledger transaction per debt. Fine at realistic debt counts (0 or 1); would want
  bounding if a rider ever accumulated many.
