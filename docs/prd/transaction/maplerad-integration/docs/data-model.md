# Data Model & Migrations

Use **expand/contract**. Never couple a destructive step to dependent code.

## New columns / tables

- `user.maplerad_customer_id` — 1:1 customer mapping.
- `virtual_account` — `{user_id, account_number, bank_name, account_name, status, created_at}`.
- `provider_reference` — links a domain operation (transfer/bill) to a Maplerad `ref` + `provider_ref` + status.
- `webhook_event` — dedupe store `{event_id (unique), type, payload, received_at, processed_at}`.
- Ledger entries (reuse) gain a `ref` and `source=maplerad` tag for provenance.

## Expand/contract sequence

1. **Expand** — add new tables/columns (nullable); deploy.
2. **Dual-write/backfill** — populate mappings; code writes new shape.
3. **Switch reads** to the new shape behind the feature flag.
4. **Contract** — remove any superseded structures in a *later* release, with rollback.

## Constraints

- `webhook_event.event_id` unique (idempotency).
- `provider_reference.ref` unique (idempotency).
- Ledger remains append-only (no UPDATE/DELETE).
