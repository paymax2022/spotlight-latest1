# ADR-034: A promo discount is bounded by its funder's settlement leg, at placement

- **Status:** Accepted
- **Date:** 2026-08-13
- **Module:** `backend/internal/restaurant` (food delivery money path)
- **Related:** ADR-033 (escrow tier gate — its gate runs immediately before this reservation); `backend/internal/finance/settlement`
  (`Split.DiscountKobo` / `DiscountFundedByPlatform`), migration
  `20261014000000_restaurant_promos.sql`

## Context

`PlaceOrder` now resolves `PlaceOrderRequest.PromoCode` and deducts the discount from
the escrowed total. The settlement engine already supported this: at release it
reconstructs the pre-discount gross and charges the discount to exactly one party.

```
base  = escrowed total − tip − service fee     (= gross − discount)
gross = base + discount                        (what the 80/10/10 percentages price)
```

The critical property is that **the escrow only ever holds what the customer paid**
(`gross − discount`). There is no external pot a discount can be drawn from, so it is
funded by shrinking exactly one leg of a split that must still sum to the escrowed
total. `settlement.Settle` fails closed when a leg would go negative.

That fail-closed check is correct but it fires at the *wrong time* for an order that has
already been escrowed: the customer's money is in escrow, `Settle` refuses forever, and
nothing in the order lifecycle can resolve it. A single over-generous promo — say
platform-funded 20% off, when the platform's own leg is 10% of the gross — would strand
every order that used it.

## Decision

The bound is enforced **at placement, before anything is escrowed** (`promoFunderCapKobo`
+ `assertDiscountFundable` in `promo.go`), and it is derived from the same arithmetic
`Settle` performs, so the two cannot drift:

| funder       | cap on the discount                                   |
| ------------ | ----------------------------------------------------- |
| `platform`   | `int64(gross × splitPlatformPct)` — its own leg        |
| `restaurant` | `gross − platformLeg − riderLeg` — the provider remainder |

Two supporting decisions:

1. **The percentages live in one place.** `splitProviderPct` / `splitPlatformPct` /
   `splitRiderPct` are declared once in `service.go` and used by both `settleOrder` and
   the cap. A cap computed from a stale copy of the percentages is worse than no cap.
2. **The restaurant-funded cap uses the with-rider split (80%), not the rider-less one
   (90%).** A rider can be assigned after placement, so only the tighter bound is safe to
   commit to at order time.

Exceeding the cap returns `ErrPromoInvalid`, which the handler maps to **422** — the code
is real, it simply cannot be applied to this order. The customer can retry without it.

## Consequences

- No promo can produce an order that cannot settle. The escrow-stranding failure mode is
  unreachable from the API.
- A platform-funded promo can never discount more than the platform earns on the order.
  This is an economic fact of an escrow-funded marketplace, not a policy knob: funding
  more would require paying money *into* the settlement from outside, and no such rail
  exists. Deep platform-funded discounts need a subsidy mechanism, not a bigger cap.
- **`free_delivery` is sharply limited, and the limit bites at realistic order sizes.**
  The discount equals the delivery fee, so the cap resolves to a condition on the cart:

  | funder       | passes only when                            | with the flat 50,000 kobo fee |
  | ------------ | ------------------------------------------- | ----------------------------- |
  | `platform`   | `delivery ≤ ⌊(items + delivery)/10⌋` ⟺ `items ≥ 9 × delivery` | items ≥ ₦4,500 |
  | `restaurant` | `delivery ≤ items − ⌊…/10⌋ − ⌊…/10⌋` ≈ `items ≥ ¼ × delivery` | items ≥ ~₦125 |

  Migration `20261020000000_restaurant_pricing_v2.sql` describes `free_delivery` as "a
  platform-funded discount"; as documented it returns 422 for every cart under ₦4,500 of
  food. That is the leg-shrink model being honest — the platform cannot pay a ₦500
  delivery fee out of a ₦95 cut — but it means platform-funded free delivery is not a
  usable campaign on small carts today. Making it usable requires an external
  promo-budget account that pays *into* the escrow, which this model cannot express;
  until then, prefer restaurant-funded `free_delivery`, whose bound is far looser.
- **Known limitation (accepted, not hidden):** for a platform-funded promo the Commission
  & Profit registry records the full pre-discount gross, so it overstates realized profit
  by the funded discount. `CommissionRecorder.RecordFor` takes only a gross and derives
  the cut from the central rate card — there is no way to express "and we gave this much
  back". The **ledger is unaffected and remains the source of truth**; `Settle` already
  posted the reduced platform leg. Netting this out needs a `RecordFor` variant that
  accepts an explicit realized-fee amount, which is out of scope for this module.

## Ordering constraints this decision imposes on PlaceOrder

Three sequencing rules fall out of the above and are load-bearing:

1. **The idempotency-key replay check runs before promo resolution.** Promo checks are
   stateful and time-dependent, so replaying an order whose redemption already committed
   would fail its own limit and 422 an order that exists and is escrowed. A client that
   believes that 422 retries on a fresh key and is charged twice.
2. **The usage-limit check that decides the outcome is the one under `SELECT … FOR UPDATE`
   on the promo row, on the order's own transaction.** The earlier unlocked check only
   sizes the discount. Without the lock, N concurrent placements all read "0 redeemed"
   and all commit — proven by `TestLiveDB_OrderPromoUsageLimitHoldsUnderConcurrency`,
   which lets 8 of 8 through when the lock is removed.
3. **That lock is taken before `settlement.Escrow`**, so the loser of the race is rejected
   with nothing escrowed to unwind — but it is released BEFORE the escrow runs, in its own
   short transaction. Holding it across the escrow is what caused a hard deadlock: `Escrow`
   acquires a second pool connection of its own, so every in-flight order pinned two, and
   once concurrency reached half the pool every connection was held by an order transaction
   waiting for one that could never come free. `PlaceOrder` therefore runs as phases that
   each hold at most one connection: tier gate (reads only) → reserve → escrow → order tx.
4. **The tier gate runs before the reservation** (ADR-033). It reads only, so it can sit
   ahead without weakening its own "nothing to reverse" property, and gating after the
   reservation would let a tier-blocked order burn a slot off a single-use campaign.

A fully refunded order (cancel, reject, dispatch failure) **releases** its redemption.
Otherwise a single-use campaign dies the first time anyone places-and-cancels at zero
cost to themselves, and a restaurant-initiated cancellation silently burns the customer's
per-user allowance.

## Alternatives considered

- **Let `Settle` reject it.** Rejected: the check is right but arrives after the money is
  escrowed, converting a bad promo into stranded customer funds.
- **Silently clamp the discount to the cap.** Rejected: the customer would be charged more
  than the code they entered promised, with no signal. Failing the order is honest.
- **Fall back to restaurant-funding when the platform cannot cover it.** Rejected: it
  spends a merchant's money on a platform promotion without their consent.
