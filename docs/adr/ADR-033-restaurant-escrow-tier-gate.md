# ADR-033: The food-order escrow is tier-gated, and an unwired gate refuses

- **Status:** Accepted
- **Date:** 2026-08-13
- **Module:** `backend/internal/restaurant`
- **Supersedes / relates to:** CLAUDE.md iron rule #4 ("every money mutation must pass
  tier-limit checks fail-closed"); ADR-001 (KYC tier model)

## Context

`restaurant.PlaceOrder` escrows the customer's order total through
`settlement.Escrow`, which posts a real `DEBIT` against the customer's wallet ledger
account. That makes placing a food order a wallet debit in exactly the same sense as a
transfer or a merchant withdrawal.

It was not gated. The `TierLimiter` seam existed on the service (`Service.tiers`,
injected via `WithTiers`) and `EnforceWalletDebitLimit` was called from exactly one
place — `withdrawal.go`, the merchant payout path. The customer-facing order escrow
never called it. Two consequences:

1. A **Tier 0** customer — whose wallet is supposed to be disabled entirely until KYC
   completes — could order food and have their wallet debited.
2. Any customer could exceed their **daily wallet debit cap** by ordering food. The
   cap was enforced on transfers and withdrawals but not here, so food delivery was an
   uncapped side door out of the wallet. Because `tiers` measures the day's spend by
   summing `user_wallet` `DEBIT` entries, the un-gated escrow *also* consumed the cap
   silently: an ungated ₦80,000 order would then block a legitimate ₦10,000 transfer.

This was raised as a blocker by the `ledger-auditor` review on PR #96 (the tip fix) and
deliberately deferred out of that PR, because gating the escrow changes behaviour for
every food order rather than only tipped ones.

A second, quieter problem surfaced while fixing the first: the restaurant service was
never wired with a tier gate in production at all. `internal/app/finance_routes.go`
built it as `restaurant.NewService(pool, settlementSvcR).WithLedger(ledgerSvc)` — no
`WithTiers`. So `Service.tiers` was nil in every running deployment.

## Decision

### 1. Gate the escrow on the full escrowed total

`PlaceOrder` calls `s.tiers.EnforceWalletDebitLimit(ctx, customerID, total)`
immediately before `s.settlement.Escrow`, where `total = subtotal + delivery + tip`.

The gate prices the **whole** amount leaving the wallet, not the food subtotal. Gating
only the subtotal would let the delivery fee and the tip escape the cap — and the tip
is client-supplied, which would make it the obvious lever for routing around the limit.

Placement is load-bearing in both directions:

- **After** the free validations (closed restaurant, unknown or unavailable item,
  min-order, tip bound), so each keeps returning its own specific error and a cart that
  would be refused anyway never costs a tier lookup.
- **Immediately before** `settlement.Escrow`, with nothing between them, so a refused
  order leaves no ledger entry, no settlement row and no order row. There is nothing to
  reverse, because nothing was written.

### 1a. An idempotent replay is resolved BEFORE the gate

`PlaceOrder` now resolves an existing order for the request's Idempotency-Key at the top
of the function and returns it, before any validation or gating.

This ordering is not cosmetic — it is what keeps the gate from breaking idempotency.
`tiers` measures the day's spend by summing the customer's wallet `DEBIT` entries, and on
a replay those already include *this order's own* escrow debit. Gating a replay therefore
counts the request against itself: a Tier 1 customer whose order is more than half their
remaining allowance would get `daily limit exceeded` on the retry, even though the money
had already moved and the order existed. The client would read that as a hard rejection
and might re-order under a fresh key, paying twice.

`RequestWithdrawal` already had this ordering (its `getWithdrawalByIdem` lookup precedes
`EnforceWalletDebitLimit`); `PlaceOrder` was the outlier. The post-`INSERT`
`ON CONFLICT DO NOTHING` branch remains as the backstop for two requests that clear the
fast path concurrently.

The replay lookup is scoped to the **calling** customer. Idempotency-Keys are
client-chosen, so resolving one to whichever order happens to hold it would let any
caller read a stranger's order by replaying their key. A key that exists but belongs to
someone else now resolves to "not found" rather than returning the other customer's
order. Where the victim's order row exists this was an information leak rather than a
loss — `settlement.Escrow` dedups on the key, so no second debit is posted — but in the
crash window described in §1b (escrow committed, order row absent) an unscoped lookup
would have produced an order for the *stranger*, backed by the victim's escrowed funds,
with the stranger debited nothing. The same reasoning applies to the merchant side, so
`getWithdrawalByIdem` / `getWithdrawalByIdemTx` are scoped by `user_id` here too — they
had the identical unscoped lookup, returning another merchant's amount, bank account and
provider reference.

### 1b. A retry whose escrow already committed is not re-gated

`settlement.Escrow` can commit — ledger debit plus settlement row — while the order
transaction that follows it fails: an item deleted mid-flight, a commit timeout, a pod
restart. Escrow is documented as idempotent precisely so the customer's retry heals that;
the debit dedups and the order row finally lands.

Gating the escrow broke that recovery. The retry has no order row, so §1a's fast path
cannot see it, and the customer's wallet debit is *already posted* — so re-running the
limit counts the order against itself and refuses the retry. The escrow would then sit
with no order attached: invisible to the reconciler (which joins `orders`) and with no
path to a refund. Funds stranded, permanently, by the gate meant to protect them.

`PlaceOrder` therefore checks `escrowCommittedFor(idempotencyKey, customerID)` and skips
the **limit** when this customer's escrow for this key already exists. There is nothing
left to authorise: the money already moved and `Escrow` will post no second debit.

The **nil-gate** check stays unconditional — a deployment with no gate must not place
orders at all, healing or otherwise. `escrowCommittedFor` itself fails closed: if the
lookup errors we refuse rather than guess, which leaves a retryable error and moves no
money.

### 2. A nil gate refuses — it is not a dev-mode bypass

`Service.tiers == nil` returns `ErrTierGateUnwired` rather than proceeding ungated.

This follows the precedent already set by `RequestWithdrawal`, which has refused an
unwired gate since it was written. Both paths now share the one `ErrTierGateUnwired`
sentinel so an unwired deployment answers identically (503) whichever money path is hit.

The alternative — documenting nil as a permissive dev-only bypass — was rejected. The
failure mode is silent and production-shaped: the exact misconfiguration we found in
`finance_routes.go` is what "nil means unlimited" would have hidden indefinitely. A gate
whose absence is indistinguishable from a gate that passes is not a fail-closed gate.
Refusing makes a missing gate loud, immediate, and impossible to ship past.

The cost is real and accepted: any caller constructing the service without `WithTiers`
now gets no ordering. In practice that is one production wiring site (fixed here) and
the live-DB tests (updated here), and a wiring bug that takes down ordering with a 503
is strictly preferable to one that escrows past a KYC limit.

### 3. Wire the gate in production

`finance_routes.go` now builds the service as
`restaurant.NewService(pool, settlementSvcR).WithLedger(ledgerSvc).WithTiers(tiersSvc)`.
`tiersSvc` was already constructed in the same function for the wallet/transfer paths.

This also repairs merchant withdrawals, which had been failing closed on the unwired
gate for as long as the wiring gap existed.

### 4. HTTP status mapping

`PlaceOrder` previously returned 500 for every error. `escrowErrStatus` now maps the
money-path refusals; everything else keeps the existing default.

| Error | Status | Why |
|---|---|---|
| `tiers.ErrWalletDisabled` | 403 | Well-formed request; the caller's tier forbids the debit |
| `tiers.ErrDailyLimitExceeded` | 403 | Same — permission, not malformed input |
| `ledger.ErrInsufficientFunds` | 402 | Already the documented code on this endpoint |
| `ErrTierGateUnwired` | 503 | Server misconfiguration, retryable once wired |
| `ErrOrderMissingIdem` | 400 | Missing Idempotency-Key (handler-level backstop) |
| anything else | 500 | Unchanged |

A fail-closed *tier lookup* failure (no `user_profiles` row, DB error) stays 500: the
server genuinely could not determine the answer, and that is not the caller's fault.

`FinalizeGroupOrder` escrows through `PlaceOrder`, so its handler consults the same
mapping before falling back to its own `statusCodeFor` default.

## Scope of the gate

Every escrow path in the module now runs through the one gated `PlaceOrder`:

- **Direct order** (`POST /restaurant/:id/orders`) — gated here.
- **Group order** (`FinalizeGroupOrder`) — delegates to `PlaceOrder`, so it inherits the
  gate. A host cannot use a shared cart to route around their own cap, and a
  gate-refused finalize re-opens the group instead of wedging it in `locked`.
- **Scheduled orders** — no separate escrow. `ActivateScheduledOrders` only releases an
  already-escrowed order into the live queue or refunds it; the escrow happened at
  placement time, through `PlaceOrder`. (Note: `PlaceOrderRequest.ScheduledFor` is
  currently inert — `PlaceOrder` neither validates it via `validateScheduledFor` nor
  writes `orders.scheduled_for`. That is a pre-existing gap, unrelated to this ADR, and
  it creates no ungated money path.)

## Consequences

- Food orders are now capped by KYC tier, consistently with transfers and withdrawals.
- A deployment that forgets `WithTiers` serves 503 on ordering rather than escrowing
  ungated.
- Live-DB tests that place orders must now seed a `user_profiles` row for the paying
  customer (`seedKYCTier` in `tierlimit_live_db_test.go`). Seeding a customer means
  seeding a tier.

### Rollout risk — this is the part to read before merging

**Tier 0 customers cannot order at all until KYC completes.** That is the intended
behaviour of a disabled wallet, but it is a behaviour change for *every* food order, and
the tier distribution makes it a large one: roughly 94% of profiles on the local database
are Tier 0. That local figure is polluted by test seeding and is only a hint — **the
production split must be measured before this ships**, and a backfill of
legitimately-verified users is likely needed first.

Two related issues that this ADR does **not** fix, and that should be settled as part of
the rollout rather than discovered in production:

1. **The card rail charges before it learns the order will be refused.** In the mobile
   checkout (`mobile-app/reactnative/src/features/payments/usePurchasePayment.ts`),
   `runPay` opens the Paystack gateway and only calls `placeOrder` in `onSuccess`. A
   Tier 0 customer therefore completes a card charge and *then* receives 403
   `tiers: wallet disabled` — money credited to a wallet they are not allowed to spend,
   and no order. The insufficient-funds case always had this shape; Tier 0 turns it from
   an edge case into the default path. The fix is a client-side `tiers.GetUsage` check
   before `pay.start()`, in the mobile module.
2. **No feature flag.** `FeatureRestaurantEnabled` gates the whole module, not this gate.
   A staged rollout would need a separate flag — deliberately not added here, because a
   bypass switch on a fail-closed money gate is the thing the iron rule exists to
   prevent. If a staged rollout is wanted, stage the *backfill*, not the gate.

### Known limits of the gate (accepted, not fixed here)

- **A refunded order still consumes the day's cap.** `tiers.getDailyDebited` sums wallet
  `DEBIT` entries and never nets back the `CREDIT` a refund posts. A Tier 1 customer who
  places a ₦40,000 order that the restaurant then rejects has had ₦0 net leave their
  wallet, but ₦10,000 of allowance left for the day — across food, transfers and
  withdrawals alike. `ActivateScheduledOrders` can do this *server-initiated*, burning a
  customer's cap because a restaurant closed. These are pre-existing `tiers` semantics
  shared with every other caller, but food delivery is the highest-cancellation vertical
  in the app, so this PR is what makes them bite. Netting refunds belongs in `tiers`, as
  its own change, and would affect every module at once.
- **Gate/debit TOCTOU.** The tier read is not taken under the per-wallet advisory lock
  that serialises the debit (`ledger/repository.go` takes it later, inside the debit tx).
  Two concurrent orders can both read the same "spent today" figure, both pass, and
  jointly exceed the cap. This is true of every `EnforceWalletDebitLimit` caller in the
  repo — transfers, withdrawals, doctor, transport, estate — and is not introduced here.
  The real fix is a repo-wide one: re-check the cap inside the debit transaction under
  the wallet lock. Until then, "fail-closed" in this ADR means fail-closed against a
  *sequential* view of the day's spend.
- **The daily window is UTC, not Lagos.** `tiers.getDailyDebited` truncates to a UTC day
  while this module prices delivery in `Africa/Lagos`, so a customer's cap resets at
  01:00 local. Pre-existing `tiers` semantics, shared with every caller; noted here
  because food ordering is the first place customers will notice it.
- **An undeterminable tier returns 500, not 403.** `tiers` wraps `pgx.ErrNoRows` in an
  untyped error, so a customer with no `user_profiles` row gets an opaque 500. The
  refusal is correct and is the strongest fail-closed case; only the status is unhelpful.
  A `tiers.ErrTierUnknown` sentinel mapped to 403 would fix it, in `tiers`.

## Alternatives considered

- **Gate the subtotal only.** Rejected: leaves delivery and the client-supplied tip
  outside the cap.
- **Gate inside `settlement.Escrow`.** Rejected: settlement is shared by modules with
  different limit semantics (transport, stays, crowdfunding), and it has no view of who
  should be limited on a multi-party escrow. The caller owns its own gate.
- **Nil gate = unlimited, documented as dev-only.** Rejected — see §2.
- **Warn-and-allow for a transition period.** Rejected: a money-path check that logs
  and proceeds is not fail-closed, and CLAUDE.md's iron rule does not have a soft mode.

## Verification

`backend/internal/restaurant/tierlimit_live_db_test.go` (live-DB, `TestLiveDB_*`):

| Test | Asserts |
|---|---|
| `..._UnderLimit` | An in-cap order still succeeds and still posts the balanced escrow pair |
| `..._GatesTheFullEscrowedTotal` | The gate is handed exactly `order.TotalKobo` — subtotal + delivery + tip |
| `..._ReplayNotRegated` | A replay returns the original order, is not re-gated, and posts no second debit |
| `..._StrandedEscrowRetryHeals` | A retry whose escrow committed but whose order row did not still heals, with no second debit |
| `TestLiveDB_OrderIdempotencyKeyIsCustomerScoped` | Replaying another customer's key does not return their order |
| `TestLiveDB_OrderRequiresIdempotencyKey` | An empty key is refused rather than resolving the `''`-keyed row |
| `..._OverLimit` | An over-cap order returns `tiers.ErrDailyLimitExceeded` and writes nothing |
| `..._OverLimitCumulative` | The cap is cumulative across the day, not per-order |
| `..._Tier0WalletDisabled` | Tier 0 returns `tiers.ErrWalletDisabled` and writes nothing |
| `..._NoProfileFailsClosed` | An undeterminable tier refuses (the strongest fail-closed case) |
| `..._UnwiredGateRefuses` | A nil gate returns `ErrTierGateUnwired` and writes nothing |
| `TestLiveDB_GroupOrderEscrowTierGate` | Group finalize inherits the gate; the group re-opens |

"Writes nothing" is asserted as: zero `ledger_entries` for the escrow legs, zero
`settlements`, zero `orders` for the request's Idempotency-Key, and an unchanged wallet
balance. Customers are funded well past every amount ordered, so a rejection can only
ever be the gate and never an insufficient-funds error wearing its coat.

`..._GatesTheFullEscrowedTotal` uses a recording fake `TierLimiter` rather than a real
limit, deliberately. The cap tests all place orders either far under or far over the
limit, so the ₦500 delivery fee and the tip never change an outcome — every one of them
would still pass if the gate priced only the food subtotal. Recording the amount and
comparing it to `order.TotalKobo` is what actually pins §1.

Unit tests (no DB): `handler_escrow_status_test.go` pins the HTTP mapping *through the
error wrapping*, so swapping a `%w` for a `%v` in the service can no longer silently turn
a 403 into a 500 with the live-DB suite still green.
