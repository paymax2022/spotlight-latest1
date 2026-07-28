# Reconciliation

Non-negotiable. The internal ledger and Maplerad custody must agree; reconciliation is how we know.

## Jobs

### reconcile-maplerad.job
- Pull Maplerad **Transactions** / wallet balances; compare to internal derived balances per wallet.
- **Daily full** reconciliation + **near-real-time spot checks** on high-value flows.
- Any drift → **quarantine + symptom-based alert** to a named owner. Never auto-correct silently.

### orphan-transfer-sweep.job
- Find `PENDING` transfers with no terminal webhook past TTL.
- Re-query via `TransferPort.getTransfer(providerRef)` and transition accordingly.

## Drift handling

- Record the discrepancy (expected vs provider) immutably.
- Hold affected wallet operations if material; open an ops case.
- Resolution is a human-reviewed compensating ledger entry — append-only, audited — not a balance edit.

## Metrics to emit

- Reconciliation drift count/value, webhook lag, transfer success rate, VA credit latency.
