# Transfer State Machine

```
INITIATED ──resolve institution + counterparty──► PENDING ──webhook:success──► SUCCESS
                                                       ├──webhook:failed────► FAILED
                                                       └──webhook:reversed──► REVERSED
```

All terminal states are reached **only via webhook** (or a reconciliation re-query for orphans). The sync response from `initiateTransfer` sets `PENDING`, never `SUCCESS`.

## Ledger postings per transition

| Transition | Ledger action |
|---|---|
| → INITIATED | Validate derived balance ≥ amount + fees. |
| → PENDING | Post `PENDING` debit (hold) keyed by `ref`. |
| → SUCCESS | Finalize hold to a settled debit. |
| → FAILED | Reverse the `PENDING` hold (funds back to available). |
| → REVERSED | Reverse a previously settled debit (append compensating entry). |

Every entry is append-only and references `ref`. No entry is ever mutated or deleted.

## Idempotency & retries

- `initiateTransfer` with an existing `ref` returns the stored provider result; it never sends twice.
- Webhook redelivery is deduped by event id; reprocessing a terminal transition is a no-op.

## Orphans

- A `PENDING` transfer with no terminal webhook past TTL is re-queried via `getTransfer(providerRef)` by the orphan sweep job, then transitioned accordingly. Never left dangling.
