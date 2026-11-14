# ADR-062: A restaurant's per-order receipt ceiling is derived from the owner's KYC tier and enforced inside pricing

- **Status:** Accepted
- **Date:** 2026-11-14
- **Module:** restaurant (merchant money-in) / finance/tiers
- **Supersedes:** nothing. Extends ADR-001 (the KYC spend ladder) to the payee side,
  and follows ADR-033 (fail-closed money gates) and ADR-042/043 (Tier-0 card top-up and
  the separate checkout allowance).

## Context

The ask was to make restaurant "KYB / account validation" consistent with tier KYC:
money a customer pays should land in the restaurant's wallet, the restaurant should be
able to withdraw it, and **a restaurant should not be able to receive an order worth
more than its verification level**.

Two of those three were already true, and saying so matters because it narrowed this
decision to one gate:

- **Money in.** `settlement.Settle` already credits the 80/10/10 split to
  `restaurants.owner_id`'s `user_wallet` (`service.go` `settleOrder`, `ProviderID:
  ownerID`). No new "restaurant account" object was needed, and inventing one would
  have created a second ledger for the same money.
- **Money out.** The owner withdraws through the ordinary wallet rail
  (`/wallet/withdraw`), which is tier-gated at the wallet level (`withdrawal.go`,
  `ErrTierGateUnwired` when unconfigured). `restaurant_withdrawals` is a separate,
  flag-dark rail with a `NoopDisburser` and is not what merchants use today.
- **Receipt ceiling.** Did not exist. **This was the gap, and it is a KYC bypass, not a
  nicety:** every other rung of ADR-001 prices the account that *pays*. An unverified
  account could stand up an outlet and receive unlimited card-funded orders into it —
  a card-funded order debits no wallet, so `EnforceCheckoutDebitLimit` and
  `EnforceWalletDebitLimitTx` never run on it. The money still leaves the platform the
  same way, through that owner's later withdrawal, from an account that has never
  proven who it belongs to. The customer-side gate structurally cannot cover this case;
  it looks at the wrong party.

The second question was what "the restaurant's KYC status" means. `restaurants.kyb_status`
(draft → under_review → approved) is a **business-documents** review and is already the
gate for *opening for orders*. The tier ladder lives in `user_profiles.kyc_tier` on the
person. The decision taken is that the receipt ceiling reads the **owner's personal
`kyc_tier`** — no `restaurants.kyb_tier` column. One ladder, one identity, no second
verification state to keep in sync, and no way for an outlet to inherit a level its
owner has not been granted.

## Decision

**1. The ceiling is the owner's tier, expressed per order:**

| Owner tier | May receive an order up to | Source |
|---|---|---|
| Tier 0 (unverified) | ₦20,000 | `SmallTransactionMaxKobo` |
| Tier 1 | ₦50,000 | `GetConfig(Tier1).DailyDebitLimitKobo` |
| Tier 2 | ₦200,000 | `GetConfig(Tier2).DailyDebitLimitKobo` |
| Tier 3 (fully verified) | unlimited | sentinel `0` |
| anything else (unknown, negative) | ₦20,000 | the strictest rung |

`tiers.MerchantReceiptLimitKobo(t Tier)` is the only place this mapping is written.
Capped rungs deliberately *reuse* their own daily-spend number rather than inventing a
receipt-specific one, and `TestMerchantReceiptLimit_VerifiedTiersMirrorTheirOwnDailyCap`
makes that derivation an assertion instead of a habit.

Tier 0 does **not** read `GetConfig(Tier0).DailyDebitLimitKobo`, because on the payer side
0 there means "wallet disabled" and on the payee side 0 means "unlimited" — the same
literal, opposite meanings. Borrowing the small-transaction number is what keeps the
fallback safe. For the same reason a tier this build does not recognise returns the
strictest ceiling rather than `GetConfig`'s zero.

**2. Per order, not per day.** "Cannot receive an order that is more than its KYC
status" is a statement about one order, and a cumulative daily receipt cap was
considered and rejected: it needs a ledger of today's receipts (a new aggregate, new
race semantics, new failure modes), and it converts a verification rule into a revenue
quota that punishes a busy small merchant for trading. The boundary is inclusive —
exactly-at-ceiling is accepted — which `TestLiveDB_MerchantReceiptGate_BoundaryIsExactAndPerOrder`
pins by taking the same ₦50,000 order twice in a row and then refusing one kobo more.

**3. Enforced inside `priceOrder`, at the moment the gated number exists.** The gate sits
immediately after `total := grossKobo - discountKobo + serviceFeeKobo + tipKobo +
packagingKobo` (`service.go:777`) rather than in `PlaceOrder`. Pricing is the single step
shared by every rail — `QuoteOrder` (the card rail's pre-charge amount), the wallet
escrow, `QuoteBreakdown`, `PreviewPromo`, signed-quote consumption, and
`PlaceOrderPaystackFunded`'s post-charge re-price — so refusing there refuses *before any
money moves*: no customer is ever prompted to pay for an order the seller cannot legally
take, and there is no charge to reverse. Gating the food subtotal would have left the tip,
delivery fee and packaging as levers around the ceiling; the gated amount is exactly the
number that will settle to the owner.

**4. Fail closed on a missing gate, fail *strict* on a missing tier.**
`enforceMerchantReceiptLimit` returns `ErrTierGateUnwired` (503) when the service was
built without a tier gate — ADR-033's rule that an unwired money gate is a
misconfiguration, never a bypass. A missing `user_profiles` row, by contrast, is **not**
an error: it is read as Tier 0. This is the one place the payee rule differs from the
payer rule, and deliberately. On the payer side an unreadable tier must stop the debit;
on the payee side a hard failure would mean an outlet whose owner has no profile row
cannot receive *any* order — a 500 at the door for the plainest state in the database.
Reading it as unlimited would be the bypass this ADR exists to close. The strictest rung
is the only answer that is neither.

Note that in practice every account *does* have a row: the `auth.users` trigger creates
`user_profiles` with `kyc_tier DEFAULT 0`, which `TestLiveDB_EnforceMerchantReceiptLimit_NewAccountIsCappedAtTier0`
now pins. The `ErrNoRows` branch is for legacy rows, and the two states must agree.

**5. No `...Tx` counterpart.** The payer-side gate has a transactional variant because it
sums *today's already-posted legs* under `pg_advisory_xact_lock` and is therefore racing
itself. This rule reads one row and compares one number that exists only in the current
request, so a pooled read is not a check-then-act on shared state. Adding a `Tx` twin
would imply an aggregate that does not exist. The interface comment says this, so the
absence reads as a decision rather than an oversight.

**6. How the refusal is said.** 403 on every restaurant rail via `escrowErrStatus`, and
`{"error":"merchant_order_limit"}` at 403 from `paystackcheckout`'s `fail()` — plus
`tier_gate_unwired` at 503, which the quote path can now produce and previously could
not. Not 400: the request is well-formed and the customer did nothing wrong. The message
names the seller ("the seller must complete KYC to accept it") because the fix belongs to
the seller; an unhelpful-looking message is the honest shape of a refusal the payer cannot
act on.

**7. Surfaced, not hidden.** `GET /api/v1/me/tier` gained `merchantOrderLimitKobo`,
derived from the same `tiers` code the gate uses, and the restaurant KYB screen states the
owner's current ceiling in one line when it is finite. The number is read from the server
rather than re-derived client-side so the screen cannot drift from the gate; when the read
fails or the field is absent the line renders nothing rather than guessing.

## Consequences

### Positive
- The KYC ladder now constrains money in as well as money out; an unverified account
  cannot use a restaurant as an unlimited card-funded collection point.
- One gate covers the wallet rail, the card rail, the quote/pre-price rails and the
  post-charge re-price, because all of them already share `priceOrder`.
- Merchants see their own ceiling in words on the screen where they go to get verified.
- No schema change, no new verification state, no new aggregate.

### Negative / trade-offs
- **Rollout is a behaviour change for live merchants.** Because a new account's tier is 0
  by default, every outlet whose owner has not completed KYC begins refusing carts over
  ₦20,000 the moment this ships. This is not hypothetical: six existing restaurant
  live-DB tests went red during implementation for exactly this reason — their fixtures
  seed the *customer's* tier and let the outlet owner sit at the trigger-created Tier 0,
  so a ₦60,000 fixture item tripped the receipt ceiling before the daily cap they were
  asserting. The fixtures now seed the outlet owner at Tier 3 with the same reasoning
  they already used for the customer ("these tests are about X, not the cap"). A
  migration that raises existing verified merchants' tiers is out of scope here; whether
  any live outlet is silently trading at Tier 0 is a rollout question for ops.
- A multi-outlet cart is gated on the **primary** restaurant's owner against the **whole
  cart** — the same single-payee simplification promo scoping already makes. Acceptable
  because the settlement leg does go to that one owner; noted in the code so it is not
  mistaken for per-outlet accounting.
- The ceiling is invisible to the seller until an order is refused: the merchant is not
  pushed a notification when a customer is turned away.

### Risks
- `checkout_allowance_boundary_test.go` greps *source* for method names to prove the
  checkout allowance is never relaxed on cash-out paths. `EnforceMerchantReceiptLimit` is
  named deliberately unlike `EnforceCheckoutDebitLimit` so it cannot be swept into that
  guard's token matching; a rename that makes the two look alike will fail a test that has
  nothing to do with this rule. Verified green with this change.
- Two ladders in one file. `MerchantReceiptLimitKobo` and `tierConfigs` can be edited
  apart; the derivation test covers the capped rungs, and Tier 0 / Tier 3 (the two that
  do not mirror) are covered by explicit boundary cases.
- ₦20,000 as the unverified ceiling is a judgement call borrowed from the payer side. If
  it turns out to be wrong for merchants it is one constant in one function — but it
  should be changed against data, not against a complaint.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Cumulative daily receipt cap | Needs a new receipts aggregate and race semantics, and turns a KYC rule into a revenue quota that penalises a busy small outlet. The requirement is per order. |
| Gate on `restaurants.kyb_status` instead of the owner's `kyc_tier` | KYB is a business review with a handful of states, not a ladder with numbers; it would mean a second verification truth to keep in sync, and an outlet could hold a level its owner was never granted. |
| A new `restaurants.kyb_tier` column | Same as above plus a migration, a backfill, and an admin surface — to store a value that already exists on the row the money lands in. |
| Gate in `PlaceOrder` only | Leaves the card rail open: `paystackcheckout.InitiateCheckout` prices before creating a Paystack transaction, and the pre-order quote screens would keep offering an order the seller cannot take. |
| Gate the food subtotal | Tip, delivery fee and packaging become levers around the ceiling, and the gated number is no longer the number that settles. |
| Fail closed when the owner has no profile row | On the payee side that turns a normal database state into "this outlet can receive nothing", with a 500. Tier 0 is the same answer for the state that actually exists, and a strictly worse failure for the state that does not. |
| Only gate wallet-funded orders | Precisely the bypass: a card-funded order debits no wallet, so no existing payer-side gate ever sees it. |

## Related

- `backend/internal/finance/tiers/service.go` — `ErrMerchantOrderLimitExceeded`,
  `MerchantReceiptLimitKobo`, `EnforceMerchantReceiptLimit`, `merchantReceiptDecision`
- `backend/internal/restaurant/service.go` — `priceOrder` (gate placement),
  `enforceMerchantReceiptLimit`, `TierLimiter`
- `backend/internal/restaurant/handler.go` — `escrowErrStatus` (403 / 503)
- `backend/internal/restaurant/paystackcheckout/service.go` — `fail()`
- `backend/internal/handlers/kyc_connect_handler.go` — `GetTierStatus`'s
  `merchantOrderLimitKobo`
- Tests: `tiers/merchant_receipt_test.go`, `tiers/merchant_receipt_live_db_test.go`,
  `restaurant/merchant_receipt_live_db_test.go`,
  `handlers/tier_status_allowance_live_db_test.go`
- Fixtures that now seed the outlet owner: `restaurant/tierlimit_live_db_test.go`
  (`tierGateFixture`), `restaurant/promo_place_order_live_db_test.go`
  (`newPromoOrderFixture`)
- Frontend: `mobile-app/reactnative/src/api/tiers.api.ts`
  (`getMerchantOrderLimitKobo`), `src/features/restaurantmerchant/hooks.ts`
  (`useMerchantOrderLimit`), `app/food/restaurant/kyb.tsx`
- Sibling: ADR-001 (the ladder), ADR-033 (fail-closed gates), ADR-042/043 (Tier-0 card
  top-up, checkout allowance)
