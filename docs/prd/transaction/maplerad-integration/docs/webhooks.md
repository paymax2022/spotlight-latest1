# Webhooks — Settlement Backbone

Single hardened endpoint. Webhooks are how money becomes real in the ledger.

## Pipeline

```
receive → verify signature → dedupe by event id → ACK fast → enqueue → process idempotently → post to ledger → audit
```

- **Verify** the signature using the vault-stored webhook secret. Reject unverified.
- **Dedupe** on a `webhook_event` table keyed by event id (Maplerad may redeliver).
- **ACK within the provider window** (the inbound-approval feature expects a response within ~5s); never do heavy work inline — enqueue and process async.
- **Idempotent processing:** reprocessing any event is a no-op.
- **Unknown event types** are logged and stored, never silently dropped.

## Event catalog (v1)

| Event | Action |
|---|---|
| Virtual account inbound credit | Post ledger CREDIT; notify user. |
| Transfer success | Transfer → SUCCESS; finalize hold. |
| Transfer failed | Transfer → FAILED; reverse hold. |
| Transfer reversed | Transfer → REVERSED; compensating entry. |
| Bill result | Resolve bill purchase (idempotent with sync result). |
| (Phase 2) Card / FX events | Out of v1 scope. |

## Security

- Restrict the endpoint, verify every payload, audit every receipt (who/what/when), rate-limit, and alert on signature-failure spikes.
