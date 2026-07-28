# ADR-012 — Maplerad WaaS integration (NGN v1) behind gateway ports

**Date:** 2026-06-30
**Status:** Accepted
**Deciders:** Platform / Backend, with Finance + Security + Compliance + QA

## Context

Paymax needs wallet/banking rails (NGN v1) on **Maplerad** (WaaS/BaaS): customer/
identity mapping, NGN virtual accounts (collections), bank transfers/payouts, and
bills — behind Paymax's provider-agnostic gateways. The integration PRD lives in
`docs/prd/transaction/maplerad-integration/`. The **internal append-only ledger is
the source of truth**; Maplerad is custody + settlement; the two are reconciled
continuously. (USD dual-wallet, card issuing, and FX are Phase 2 — not built here.)

A recon found Maplerad rails partly exist: `provider/maplerad` (collections, transfer,
FX, VA issuing) with a **stub** `VerifyWebhookSignature` (`return true`); `finance/va`
(VA provision + inbound credit via the Paystack webhook only); the append-only ledger
with a suspense-account hold pattern; KYC tier gating; per-business-key idempotency
(no event-id dedupe); and a goroutine+ticker job pattern. There is **no** Maplerad
webhook handler, **no** customer mapping, and **no** event-id dedupe.

## Decisions

### 1. Ports stay stable; the adapter is the only Maplerad code
Domain code calls **gateway ports** only. Reuse `DisbursementProvider` (banks/resolve/
recipient/payout/status) and `VirtualAccountProvider`; add three small additive ports —
`IdentityProvider` (customer create/get), `WalletProvider` (provision + `GetProviderBalance`,
reconciliation-only), `BillsProvider` (purchase + get). The **existing**
`provider/maplerad` package is extended to implement them all; no Maplerad type leaks
out of `/provider/maplerad`. A **live-vs-mock seam** (mirroring `orchestration/adapters/
maplerad_live.go`) makes sandbox/dev run deterministically without keys.

### 2. Ledger of record; money posts only on confirmation
Hot path reads the internal ledger (balances are summed projections — no mutable
balance field). Maplerad is called only to move money / provision resources, and its
outcomes post to the ledger **on confirmed webhook**, never on a bare sync return.
Holds use the existing suspense-account pattern (reserve → finalize/reverse); the
transfer "PENDING" state is the provider_reference row, not a new ledger entry type.
Ledger provenance (`source=maplerad`, `ref`, `event_id`) rides in the existing
`ledger_entries.metadata` JSONB — no ledger schema change.

### 3. Customer mapping gated by existing KYC
1 Paymax user ↔ 1 Maplerad customer, created when the user reaches the required KYC
tier (BVN/NIN forwarded to Identity). Persisted in a new `provider_customers`
(`user_id, provider, customer_id`). Capability (VA, transfers) is gated by the
existing tier **before** any Maplerad call — Maplerad is downstream of the gate.

### 4. Transfer state machine — terminal only via webhook
`INITIATED → PENDING → {SUCCESS | FAILED | REVERSED}` tracked on `provider_reference`.
`initiateTransfer` validates derived balance, posts the PENDING hold keyed by `ref`,
and returns PENDING — never SUCCESS. Webhooks finalize (success), reverse the hold
(failed), or post a compensating entry (reversed). Disallowed transitions (e.g.
INITIATED→SUCCESS, terminal→anything) are rejected; replaying a terminal is a no-op.

### 5. Webhook pipeline = the settlement backbone
One hardened endpoint: **verify signature → dedupe by `event_id` (`webhook_event`
unique) → ACK fast → process idempotently → post to ledger → audit**. Unknown event
types are stored + logged, never dropped. Real HMAC verification replaces the adapter
stub. Inbound VA credit → exactly one ledger CREDIT keyed by the event ref; transfer
events drive the state machine; bill result is idempotent across sync + webhook.

### 6. Idempotency everywhere
Every Maplerad money call carries a **client reference** persisted in
`provider_reference` (`ref` unique) before the call; a retry with the same `ref`
returns the stored result instead of re-calling. Ledger postings keyed by `ref` —
a duplicate post is a no-op (DB unique + Redis fast-path).

### 7. Reconciliation + orphan sweep (non-negotiable)
A daily `reconcile-maplerad` job compares internal derived balances to Maplerad
(`WalletProvider.GetProviderBalance` / Transactions); any drift is **quarantined**
in `reconciliation_drift` + alerted to an owner — **never auto-corrected**; resolution
is a human-reviewed compensating ledger entry. An `orphan-transfer-sweep` job
re-queries PENDING transfers past TTL via `getTransfer` and transitions them.

### 8. Sandbox-first, expand/contract, flag-gated
Build/test against Maplerad **sandbox** first; **expand-only** migrations (new
nullable tables/columns; contract later); ship behind `FEATURE_MAPLERAD_ENABLED`
(default off) with a rehearsed flag-off fallback (Paystack remains the VA/payout
fallback via the provider registry). Secrets in env/vault only; sandbox vs live keys
separated. Verify the `caveats-and-decisions.md` items (VA naming, bills sync/webhook,
inbound payload) in sandbox before live.

## Consequences
- Provider-agnostic: adding/swapping a WaaS later touches `/provider/*` only.
- Money becomes real in the ledger only via verified, deduped webhooks.
- PHI/PII (BVN/NIN) confined to the Identity call; never logged.
- Reconciliation makes custody-vs-ledger drift observable and owned.

## Open knobs (defaults shipped)
Per-tier transfer/VA limits; fee/markup policy; Bills via Maplerad vs existing
bill-pay; sole-provider vs keep Paystack/Monnify live for failover; Phase-2 timing
(USD wallets, cards, FX).
