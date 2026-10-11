# ADR-PR697 — Card-paid utility bills are collected into the wallet, then spent

- **Status:** Proposed (flag `FEATURE_UTILITY_CARD_LEDGER`, default off)
- **Related:** [ADR-040](ADR-040-wallet-plane-double-entry.md),
  [ADR-041](ADR-041-card-rail-tops-up-the-wallet.md)

## Context

A utility bill paid by card (`paymentSource: 'paystack'`) is verified server-side
by `verifyUtilityPaystackPayment` and handed to `payUtility`, whose paystack
branch only records an event. Nothing reaches `ledger_entries`:

- the admin Transactions page (ledger-only by design) never shows the payment;
- every compensation path credits the wallet for money the ledger never received
  (`PAYSTACK_REFUND`, `VALIDATION_REFUND`, admin Paystack reversal).

ADR-041 fixed the same hole for the shared checkout rail (collect into the
wallet, then spend). Bill payments were explicitly left on a server-owned path
and so were never given a collection leg.

## Decision

With the flag on, `payUtility` for a paystack-sourced bill:

1. `creditWallet` — key `utility:<tx>:CARD_COLLECT`, `reference` = receipt;
2. `debitWallet` — key `utility:<tx>:DEBIT`, identical to a wallet-sourced bill.

Net wallet effect of a successful bill is zero; the ledger shows funding and
spend. Existing refund paths become correct without change (collect, spend,
refund nets to exactly one refund).

Two guards, each pinned by a test:

- **Spend refused** (Tier 0 / daily limit) leaves the collected funds in the
  wallet. `settleFailedUtilityTransaction` detects `collectPosted && !debitPosted`
  and does **not** post `PAYSTACK_REFUND` — that would pay the customer twice.
- **Callers that assumed "any throw = nothing posted".**
  `verifyUtilityPaystackPayment` no longer posts `VALIDATION_REFUND` when
  `payUtility` already created the transaction row (it owns compensation), and
  `reverseUtilityTransaction` skips the credit for a collect-only row. The Go
  stuck sweeper (`settleFailedTransaction`) recognises `CARD_COLLECT` the same
  way (`retainCollectedFunds`); Go's admin reversal already refuses a row with
  no debit leg.
- **Reference collision.** The collect credit's `reference` is the receipt, never
  the Paystack `payment_reference`: `lookupUtilityMoneyLegs` reads any CREDIT with
  that reference as "refund already posted".

## Consequences

- Enabling the flag changes behaviour for Tier-0 and over-limit card payers: the
  bill is refused at the spend and their money stays in the wallet. This is a
  product decision to make before enabling.
- Historical card payments are not backfilled.
- Known residual (ledger-auditor MEDIUM, 0x outcome): the writer posts the
  collect then stalls >=10 minutes; the stuck sweep claims the row, sees
  collect-without-debit and retains the funds; the writer resumes, its spend
  posts, its status CAS fails (`writer_outraced`). Net: +X -X, no vend, no
  refund, alert only. A CAS touch between collect and spend would shrink the
  window to milliseconds but moves the failure to claims that land before the
  collect (2x), so it is deliberately not included; decide before enabling the
  flag in production.
- The `VALIDATION_REFUND` suppression applies whenever a transaction row exists,
  flag on or off. A throw after insert with ambiguous provider evidence now waits
  for the sweeper / manual reconciliation instead of being refunded at once.
- A replay after a refused spend marks the intent `completed` pointing at a
  `reversed` row (funds are in the wallet); cosmetic, not addressed here.
- A retained collect-only row is labelled `reversed` although no reversal
  entry exists; the event `paystack_collected_funds_retained` distinguishes it.
- The daily-limit check (`debit_wallet_atomic`) sums `type = 'DEBIT'` only, so the
  collect credit is not counted; the spend is, which is the intended behaviour.
- Other card-only modules with the same gap (contest votes, school fees, Open
  Mic votes, application fee, registration fee) are separate changes.
