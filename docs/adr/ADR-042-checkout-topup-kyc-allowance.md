# ADR-042 — An unverified account may pay by card at checkout, under a capped allowance

- **Status:** Accepted (behind `FEATURE_CHECKOUT_TOPUP_TIER0`, default OFF)
- **Date:** 2026-08-14
- **Related:** [ADR-041](ADR-041-card-rail-tops-up-the-wallet.md) (why checkout
  touches the wallet at all), ADR-001 (the KYC tier model),
  [ADR-033](ADR-033-restaurant-escrow-tier-gate.md) (module-side tier gates)

## Context

ADR-041 fixed the card rail by routing it through a wallet top-up. That was correct
for the money, but it inherited the top-up route's gate — `requireKycTier(user.id, 1)`
— and so made **card payment impossible for every unverified account**, across all
54 checkouts. Against this platform's Tier-0 population that is most users.

The gate is not incidental. Tier 0 means "wallet disabled", stated twice and
deliberately:

```
TIER_WALLET_LIMIT_KOBO[0] = 0            // "wallet disabled"
ErrWalletDisabled = "wallet disabled for tier 0 — complete KYC to activate"
```

So relaxing it needs an argument, not just a smaller number.

**The argument: an unverified account cannot get the money back out.** Both payout
paths call `enforceWalletLimit`, which hard-denies Tier 0 with "Wallet is disabled
for unverified accounts":

- `src/server/transfers/bank.ts` (wallet → bank payout)
- `src/server/transfers/wallet-to-wallet.ts` (P2P)

A checkout top-up can therefore only ever be spent on in-app goods and services. It
is not a cash-in/cash-out channel, which is what the Tier-0 wallet ban is protecting
against. The money arrives from a card that the PSP has already KYC'd on its own
side, and leaves as payment to a merchant, doctor, driver or venue.

## Decision

Top-ups gain a **purpose**, and the two purposes carry different gates.

| purpose | raised by | gate |
|---|---|---|
| `wallet` | the standalone funding screen | Tier 1 — **unchanged** |
| `checkout` | a module checkout's card rail (ADR-041) | Tier 0 permitted, under a capped rolling allowance |

`purpose` is persisted on `wallet_topup_intents`. That is not bookkeeping — the
allowance is summed over checkout intents only, so an unrecorded purpose would let
every top-up see a fresh allowance, and a user's ordinary Tier-1 funding would
otherwise consume their checkout allowance.

### The Tier-0 allowance

```
CHECKOUT_TOPUP_MAX_SINGLE_KOBO   = 1_000_000   // ₦10,000 per purchase
CHECKOUT_TOPUP_ALLOWANCE_KOBO[0] = 2_000_000   // ₦20,000 per rolling 24h
```

Tiers 1–3 already clear the standalone gate and are not additionally capped here;
their spending is bounded by the ordinary wallet daily limits.

**These two figures are compliance parameters, not engineering ones.** They decide
how much value an unverified account can move into the platform per day. They are
deliberately conservative and are the thing to argue about before enabling the flag.

Enforcement details that matter:

- The window sum counts **`pending` as well as `completed`** intents. A pending
  intent is money the user has almost certainly already been charged for — the
  webhook simply has not landed — so counting only completed ones would let a burst
  of concurrent checkouts each see a full allowance and blow straight through the
  cap.
- The cap is checked against `used + this amount`, so the top-up that *crosses* the
  limit is the one refused, not the one after it.
- An unrecognised `purpose` value is treated as `wallet`. The weaker gate must be
  opted into explicitly and can never be reached by sending a typo.
- Every path fails closed: an unreadable tier **and** an unreadable allowance
  history both deny. Allowing on a failed history read would make the cap
  unenforceable by simply breaking the query.
- Approvals and denials are both written to `tier_limit_events` with
  `limit_type = 'checkout_topup'`, so a relaxed-gate decision is as auditable as a
  wallet_daily one. An audit write failure never blocks enforcement.

### Behind a flag, default off

`FEATURE_CHECKOUT_TOPUP_TIER0`. With it off, `assertTopupAllowed` calls
`requireKycTier(userId, 1)` for every purpose — byte-identical to the behaviour
before this ADR. This is a KYC relaxation; it should be switched on deliberately,
by someone who owns the compliance decision.

## Consequences

**Good**

- Unverified users can pay by card at checkout, which is the point. ADR-041's fix
  no longer costs the platform its Tier-0 population.
- Exposure is bounded and auditable rather than binary. Previously the only
  positions available were "no wallet at all" and "full Tier-1 wallet".
- The cash-out ban is untouched. Tier 0 still cannot transfer or withdraw a kobo.

**Costs / risks**

- **A refunded purchase leaves spendable in-app balance.** `settlement.Refund`
  credits the payer's wallet, so a Tier-0 user can top up for a purchase, cancel
  it, and hold the balance. They cannot withdraw it, and it is capped at the daily
  allowance, but it is no longer tied to the purchase that justified it. Closing
  this properly means refund-to-source for checkout-funded purchases — a larger
  change, not attempted here.
- **⚠️ The tier-gated Go modules still refuse Tier-0 spends.** `restaurant`,
  `doctor`, `fractionalre` and `placement` wire a `TierLimiter`. Enabling this flag
  before those are aligned lets a Tier-0 user fund a wallet for a purchase that is
  then refused at escrow — money credited, purchase blocked, and no way to withdraw
  it. **This is the blocker on turning the flag on**, and it is why the flag ships
  off. Most modules (telemedicine, mobility, savings, social, stays…) have no tier
  gate and would work.
- The Tier-0 caps are guesses until someone with the compliance mandate signs off.
- `wallet_topup_intents.purpose` is now load-bearing for a limit. A future writer
  that forgets to set it silently grants a fresh allowance; the default of
  `'wallet'` makes that fail safe (stricter), not open.

**Not addressed here**

- Refund-to-source for checkout-funded purchases.
- Aligning the four tier-gated Go modules with the checkout allowance.
- `/wallet/balance` and `/wallet/transactions` still require Tier 1, so a Tier-0
  user who ends up holding balance cannot see it.
