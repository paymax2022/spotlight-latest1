# ADR-011 — Bank transfers (wallet→bank & bank→bank) with multi-provider routing

**Date:** 2026-06-30
**Status:** Accepted
**Deciders:** Platform / Backend, with Mobile + Admin + Finance + Security + QA

## Context

`/services/transfer` today does wallet→wallet (complete) and a wallet→bank **stub**
that reserves funds but never calls a provider (the disbursement + success legs are
missing). We need real **wallet→bank** and **bank→bank** payouts across **two
providers (Paystack + Monnify)**, plus an improved mobile UX and an admin console.
This is money-path: the iron rules (integer kobo, balanced double-entry ledger,
idempotency, fail-closed tier limits, immutable audit, provider adapters behind an
interface) apply in full.

## Decisions

### 1. bank→bank = provider pass-through (pay-in → payout)
The user funds the transfer from a bank **through the provider** (a collection into
a clearing account), and once funded it is **disbursed** to the destination bank.
Two legs, webhook-settled. Modeled on the existing `bank_transfers` row with
`source_type ∈ {wallet, bank}`:
- `wallet` (wallet→bank): debit user wallet → suspense → payout.
- `bank` (bank→bank): collection → `provider_clearing` → suspense → payout.

States (additive widening of the `bank_transfers.status` CHECK):
`funds_reserved` (wallet src) | `awaiting_funding` → `funded` (bank src) →
`provider_initiated` → `successful` | `failed` | `reversed`.

### 2. Multi-provider behind one interface, auto-failover
Extend the provider abstraction with a **DisbursementProvider** capability:
`ListBanks`, `ResolveAccount` (name enquiry), `CreateTransferRecipient`,
`InitiatePayout`, `GetTransferStatus`, `VerifyWebhookSignature`, `Name`. Implement it
for **Paystack** and **Monnify**. A small **registry** (built from whichever creds
are set) selects a **configurable default per operation** and, on a provider
error/decline, **automatically fails over** to the other; the chosen provider is
persisted on the transfer row and webhooks are routed by `:provider`. Each real
client is wrapped with a deterministic **mock fallback** (live-vs-mock seam, like
the FX `adapters/*_live.go`) so dev/CI run offline with dummy creds.

### 3. Transaction PIN gate on money movement
Money movement currently has only the login token. We add a **transaction PIN**
(`user_transaction_pin`, salted hash, attempt-lockout) that must be verified
server-side before any transfer is initiated (wallet→bank, bank→bank, and reused
for wallet→wallet). Fail-closed; never logged.

### 4. Ledger legs (balances stay ledger projections)
- **wallet→bank reserve:** DR user_wallet (amount+fee) → CR failed_transfer_suspense.
- **bank→bank funded:** the collection credits `provider_clearing`; on funded, DR
  provider_clearing (amount+fee) → CR failed_transfer_suspense.
- **success webhook:** DR suspense (amount) → CR settlement/provider_clearing, and
  DR suspense (fee) → CR paymax_revenue (recognize the fee — previously missing).
- **failure/reversal:** reverse the hold back to the source (wallet for wallet-src;
  refund/clearing for bank-src).
All movements idempotent on `reference + leg` (per-leg suffixed keys), tier-checked
on the wallet-out leg.

### 5. Generalized recipient + bank reference
`bank_transfer_recipients` gains `provider` + `provider_recipient_code`
(`paystack_recipient_code` relaxed to nullable — additive). A `payment_banks`
reference table backs the bank picker / `ListBanks` fallback. Beneficiaries are
saved on request (the existing unused `SaveBeneficiary` flag is wired).

### 6. Idempotency, audit, gating
Idempotency-Key required on every initiate (DB unique + Redis fast-path, replay
returns the prior result). Every initiate/settle/reverse/admin-retry writes an
immutable audit row. Member routes gated by `FEATURE_BANK_TRANSFERS_ENABLED`
(default off); admin routes gated by RBAC `finance.admin.transfers`.

### 7. Surfaces
- **Mobile** `/services/transfer`: a unified screen with a type switch
  (wallet→wallet · wallet→bank · bank→bank), a real **bank picker** (from
  `payment_banks`/`ListBanks`), **account-name resolve**, amount + review + **PIN**
  + receipt, beneficiaries.
- **Admin** `/admin/finance/transfers`: list (type/provider/status/amount/fee/ref),
  detail with ledger inspect, **retry** (re-attempt / failover) and **reverse**
  actions, and a **provider-health** strip.

## Consequences
- Real payouts with provider redundancy; no vendor lock-in.
- bank→bank reuses the same suspense + reversal + webhook machinery as wallet→bank.
- A genuine second factor (PIN) now guards money movement.
- Feature-flagged + dummy-cred mock so it runs before real keys are added.

## Open knobs (defaults shipped)
Default provider + failover order; per-tier transfer limits; fee schedule; whether
bank→bank is enabled for end users vs admin-only; bank list refresh cadence; PIN
length + lockout policy.
