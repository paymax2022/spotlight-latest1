# CLAUDE.md — Maplerad Wallet/Banking Integration

Wallet system, virtual accounts, payments, and money-transfer rails for Paymax, running on **Maplerad** (WaaS/BaaS) behind Paymax's provider-agnostic gateways.

**Scope (v1):** NGN only — customer/identity mapping, NGN wallets, NGN virtual accounts (Collections), bank transfers/payouts, bills.
**Phase 2 (do not build yet):** USD wallets (dual SPEND/TREASURY), card issuing, FX.

---

## Prime directive

**The internal append-only ledger is the source of truth for user balances. Maplerad is the custody + settlement layer. Reconcile continuously.**

- Show balances **derived from the internal ledger** — never read live from Maplerad in the hot path.
- Post money to the ledger only when **confirmed by webhook** (async flows), never on a bare sync response.
- A scheduled job reconciles internal balances against Maplerad; drift alerts a human.

## Non-negotiable invariants

1. Domain code calls **gateway ports only**. Maplerad SDK/HTTP lives solely in `/adapters/maplerad`. Never import it elsewhere.
2. Ledger is **append-only**; balances are **derived**. No mutable balance field.
3. Every Maplerad money call carries a **client reference / idempotency key**; the same reference never double-applies.
4. Webhooks are **verified (signature), deduped (event id), processed idempotently**, then posted + audited.
5. State changes go through **guarded state machines**; illegal states are structurally unreachable.
6. All money operations and webhook receipts are **immutably audited**.
7. KYC tier gates capability **before** Maplerad is called; Maplerad is downstream of the existing gate, not a replacement.
8. Secrets in the **vault** only — never in repo, image, or CI logs. Sandbox key for dev/staging, live key for prod.

## Repo layout

```
/payments/gateways      # ports (stable interfaces) — do not change to fit a provider
/payments/adapters/maplerad   # all Maplerad code lives here
/payments/webhooks      # maplerad.handler.ts (verify+dedupe+dispatch)
/payments/jobs          # reconcile-maplerad.job.ts, orphan-transfer-sweep.job.ts
/payments/ledger        # reuse; add posting rules only
config/maplerad.config.ts     # env + secret refs (no secret values)
```

## Build workflow

- **Sandbox first.** Build and test entirely against Maplerad sandbox before any live key.
- **Expand/contract** DB migrations only; never couple a destructive step to dependent code.
- Ship behind a **feature flag**; canary a small cohort in prod; keep a rehearsed flag-off fallback.
- Verify the §caveats in `docs/caveats-and-decisions.md` in sandbox before going live.

## docs/ index

- `docs/architecture.md` — custody-vs-ledger model, layering, customer + wallet mapping
- `docs/adapter-contracts.md` — gateway ports + Maplerad resource mapping + method contracts
- `docs/transfer-state-machine.md` — transfer lifecycle, ledger postings, orphan handling
- `docs/collections-virtual-accounts.md` — VA issuance + inbound-credit flow
- `docs/webhooks.md` — ingestion pipeline + event catalog + processing rules
- `docs/reconciliation.md` — reconciliation job, drift policy, orphan sweep
- `docs/data-model.md` — tables/columns + expand/contract migration plan
- `docs/build-plan.md` — phased build + rollout + Definition of Done
- `docs/caveats-and-decisions.md` — Maplerad gotchas to verify + open commercial decisions
- `docs/test-plan.md` — each invariant mapped to concrete test cases + CI gate
