# Build Plan & Rollout

## Phase 1 — Foundations (sandbox)
- Adapter scaffolding under `/adapters/maplerad`; client with env-scoped secret key.
- IdentityPort + customer mapping; WalletPort provisioning.
- Ledger posting rules + idempotency store.

## Phase 2 — Collections
- VirtualAccountPort (open VA); webhook endpoint (verify+dedupe+dispatch); inbound-credit → ledger CREDIT.
- Verify VA naming/payload caveats in sandbox.

## Phase 3 — Transfers & Bills
- Institutions cache; Counterparty; TransferPort + state machine + holds.
- BillsPort with sync/webhook reconciliation.
- Orphan-sweep job.

## Phase 4 — Reconciliation & hardening
- reconcile-maplerad.job + drift alerting.
- Observability: golden-signal dashboards + symptom-based alerts.
- Circuit breaker + retries/backoff around the client.

## Rollout
1. Full sandbox test pass.
2. Expand migrations to staging; backfill.
3. Staging dual-run: VA + transfer end-to-end (webhook → ledger → reconcile).
4. Prod canary behind feature flag (live key, small cohort); watch drift + golden signals.
5. Progressive widen; rehearsed flag-off fallback at every step.
6. Contract migrations after reads fully switched and stable.

## Definition of Done
- [ ] Domain calls ports only; Maplerad confined to `/adapters`
- [ ] Ledger is source of truth; balances derived; Maplerad = custody
- [ ] Customer 1:1 mapping via existing KYC; BVN/NIN to Identity
- [ ] NGN VAs open; inbound credits post via verified, deduped webhooks
- [ ] Transfers idempotent; guarded state machine; holds reverse on failure
- [ ] Webhook endpoint verifies + dedupes + processes idempotently + audits
- [ ] Reconciliation + orphan sweep with drift alerting to an owner
- [ ] Secrets in vault; sandbox/live separated; one artifact promoted across envs
- [ ] Expand/contract migrations with rollback; canary + flag rollout
- [ ] Caveats verified in sandbox before live
- [ ] Tests: adapter mapping, transfer state machine, webhook idempotency, reconciliation, authZ
