# ADR-043 — Aligning the Go tier gates with the checkout allowance

- **Status:** Accepted (behind `FEATURE_CHECKOUT_TOPUP_TIER0`, default OFF)
- **Date:** 2026-08-14
- **Related:** [ADR-042](ADR-042-checkout-topup-kyc-allowance.md) (funds it),
  [ADR-041](ADR-041-card-rail-tops-up-the-wallet.md) (why checkout touches the
  wallet), [ADR-033](ADR-033-restaurant-escrow-tier-gate.md) (the gate being
  relaxed)

## Context

ADR-042 let an unverified (Tier 0) account fund its wallet by card for a purchase
in flight, under a capped allowance. It shipped switched off, with one blocker
recorded:

> ⚠️ The tier-gated Go modules still refuse Tier-0 spends. Enabling this flag
> before those are aligned lets a Tier-0 user fund a wallet for a purchase that is
> then refused at escrow.

That is the failure this ADR closes. Funding without spending is worse than the
original refusal: the customer is charged, credited, blocked at escrow, and — being
Tier 0 — cannot withdraw what they are left holding. The old behaviour at least
refused cleanly before taking any money.

## Decision

### 1. A separate method, not a relaxed one

`tiers.Service` gains `EnforceCheckoutDebitLimit`. `EnforceWalletDebitLimit` is
**unchanged**.

Two methods rather than a purpose flag on one, because the population of call
sites that may run relaxed has to be greppable and small. A `ctx`-carried purpose
(the pattern `restaurant.WithAdminOverride` uses) would have been less invasive and
was rejected: a context marked for checkout that later flows into a withdrawal call
silently relaxes cash-out, and nothing in the type system or a code review would
show it.

For Tier 1+ the new method **delegates to `EnforceWalletDebitLimit` verbatim**, so
a verified account's limits cannot drift from the strict gate. Only Tier 0 differs.

### 2. Consumer purchases use it; cash-out and investments do not

| Path | Gate | Why |
|---|---|---|
| `restaurant` order escrow | checkout | consumer purchase |
| `transport` rider fare | checkout | consumer purchase |
| `estate` dues | checkout | resident paying for a service |
| `doctor` payout | **strict** | cash OUT — see correction below |
| `restaurant` merchant withdrawal | **strict** | cash OUT |
| `transfers` wallet-to-wallet and bank | **strict** | cash OUT |
| `fractionalre` subscribe / secondary | **strict** | investment purchase |

`fractionalre` is a deliberate exclusion, not an oversight. Buying property shares
is closer to a securities transaction than to buying dinner; that warrants stricter
KYC than consumer spending, not looser. It stays Tier 1+.

Keeping every cash-out path strict is what preserves ADR-042's entire safety
argument: **an unverified account still cannot get value back out.** If the
allowance ever reached a payout path, that argument collapses and Tier 0 becomes a
funded, extractable wallet — a KYC bypass.

`internal/placement` holds a `*tiers.Service` but never calls the gate, so despite
appearing in the original list it is not a tier-gated money path and needed nothing.

> **Correction (post-review).** This ADR originally listed `doctor` as a
> "consultation payment" and moved it onto the checkout gate. That was wrong and
> was the most serious defect a ledger-auditor review found: the call site is
> `RequestPayout`, which debits the caller's wallet to the settlement clearing
> account and queues a `doctor_payouts` row against a bank account. It is a cash
> OUT. `internal/doctor` has no consultation money path at all — the only ledger
> movement in the package is that payout. It is reverted to the strict gate and is
> now listed among the paths that must never use the allowance.
>
> The boundary test did not merely miss this: because it asserts per FILE, it
> *required* the relaxed call to be present in `internal/doctor/service.go`. The
> assertions now list that file as cash-out, and the call-site regex was widened —
> it previously matched only the `if err := …` form, so the same defect written as
> `err := …` or `return …` would have passed.

### 3. One flag for both halves

`FEATURE_CHECKOUT_TOPUP_TIER0` — the **same** environment variable the top-up gate
reads in `frontend-web`. Two flags could be switched independently, and the failure
mode of doing so is the exact trap this ADR exists to close (funded, then refused).

Default off. `tiers.NewService` leaves the allowance disabled and
`WithCheckoutAllowance` turns it on, so a call site nobody remembered to wire is
**stricter**, never looser. Transport built its own tier service internally; it now
accepts the shared, flag-configured one via `WithTiers` (the refactor its own
comment invited), and falls back to a strict self-built gate if unwired.

### 4. The caps mirror the funding side

```
CheckoutMaxSingleKobo = 1_000_000  // ₦10,000 per purchase
CheckoutAllowanceKobo = 2_000_000  // ₦20,000 per rolling 24h
```

Identical to `CHECKOUT_TOPUP_MAX_SINGLE_KOBO` / `CHECKOUT_TOPUP_ALLOWANCE_KOBO` in
`frontend-web/src/server/wallet/topup-gate.ts`. They are compliance parameters
duplicated across two languages, so a test asserts the Go values explicitly — if
they drift, a customer gets funded for a purchase they cannot make, or vice versa.

The window is rolling 24h, matching the funding side. `getDailyDebited` measures
from midnight UTC, which would have let a Tier-0 account spend a full allowance
either side of midnight.

## Consequences

**Good**

- The ADR-042 blocker is closed: a Tier-0 customer funded by the card rail can
  complete the purchase they paid for, in the modules the card rail reaches.
- The relaxation is enumerable. A test walks `internal/` and fails if
  `EnforceCheckoutDebitLimit` appears anywhere outside the four approved paths, so
  a new call site cannot appear without someone justifying it here.
- Cash-out remains strict, and a test asserts that directly against the source —
  the failure mode is a one-word edit that compiles cleanly and no arithmetic test
  would notice.

**Costs / risks**

- Two more places where Tier 0 can move money, and two languages holding the same
  caps. The drift test mitigates the second, not the first.
- The spend cap counts **all** wallet debits in the window, not just checkout ones.
  A Tier-0 account with balance from another source (a refund, a referral reward)
  consumes its own allowance faster. That is the conservative direction and is
  deliberate.
- A Tier-0 customer can still be refused mid-flight if their allowance is consumed
  between funding and spending — narrower than before, not eliminated.
- The caps remain unsigned-off by anyone with a compliance mandate.

**Not addressed here**

- Refund-to-source for checkout-funded purchases (ADR-042's residual risk: a
  refunded purchase still leaves capped in-app balance).
- `/wallet/balance` and `/wallet/transactions` still require Tier 1, so a Tier-0
  customer cannot see the balance they may now spend.
- The modules the card rail reaches that have **no** tier gate at all
  (telemedicine, savings, social, stays…) are unaffected and always permitted
  Tier-0 spends. Whether they *should* be gated is a separate question this ADR
  does not open.
