# ADR-PR855: Crypto deposits on the provider rail post no ledger entries

**Status:** Accepted · **Date:** 2026-10-22 · **Area:** crypto / money path

## Context
On the provider rail, Quidax holds each user's crypto in their own Quidax sub-account. A buy settles NGN through the platform ledger, and the crypto lands in that sub-account. The `cryptosvc` ledger only tracks NGN: clearing, wallet, revenue.

An inbound crypto deposit therefore arrives where the user's holdings already live, and the provider credits it itself. The workplan needs users to deposit to a real per-user address and see the deposit credited, with webhooks verified and re-queried.

## Decision
- **No ledger legs for a deposit.** Crediting is the provider's balance change, and the user sees it through `GET /crypto/swaps/balances`. Posting a crypto entry to an NGN ledger would invent a second, unreconciled source of truth.
- **The platform keeps a record, not a balance.** `crypto_deposits` is written only from a provider re-query (`GetDeposit`). The webhook payload is a hint, the same rule swaps follow. The record serves history, audit and notification.
  - **Status only moves forward:** `pending → accepted | rejected`, and a final status never changes.
  - **Confirmations only increase.**
  - These two rules make out-of-order and duplicate deliveries harmless.
- **Ignored vs. retried events:**
  - Ignored: events naming no account, or an account we didn't create. Retrying them can never succeed.
  - Retried: a failed re-query or a store error. These return an error so the provider redelivers.
- **One address per (user, provider, currency, network).**
  - The first address saved wins.
  - The adapter reads the current address before asking for a new one.
  - Addresses Quidax generates asynchronously return `202 address_pending`.
  - The KYC trade gate applies, fail-closed.

## Consequences
- Deposits can't unbalance the ledger, and there is nothing to reverse.
- **Platform-side limits on crypto inflow** (tier caps on deposit value) aren't enforced here. Quidax's own compliance (AML rejections → `rejected`) applies. An inflow cap would need a valuation policy, which is a separate decision.
- **Withdrawals must also move to the provider sub-account before the provider rail goes live.** The legacy withdrawal pays out from the internal ledger book, which doesn't hold provider-rail crypto.
