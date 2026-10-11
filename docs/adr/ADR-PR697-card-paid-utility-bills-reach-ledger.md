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
- **Reference collision.** The collect credit's `reference` is the receipt, never
  the Paystack `payment_reference`: `lookupUtilityMoneyLegs` reads any CREDIT with
  that reference as "refund already posted".

## Consequences

- Enabling the flag changes behaviour for Tier-0 and over-limit card payers: the
  bill is refused at the spend and their money stays in the wallet. This is a
  product decision to make before enabling.
- Historical card payments are not backfilled.
- The Go plane (`backend/internal/utilitybills`) is not mirrored here.
- Other card-only modules with the same gap (contest votes, school fees, Open
  Mic votes, application fee, registration fee) are separate changes.
