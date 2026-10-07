# ADR-PR521: Debit-first provider execution for FX conversions and payouts

- **Status:** Accepted
- **Date:** 2026-10-05
- **Module:** orchestration (`backend/internal/orchestration`)

## Context

`ExecuteConversion` and `ExecuteTransfer` originally called the external
provider *before* writing anything locally:

1. Consume quote → compliance screen → balance **check**
2. `provider.Execute*` (money may move upstream)
3. `ApplyConversion` / `ApplyTransfer` — wallet debit + ledger legs + row insert

A crash between steps 2 and 3 — or a provider success that returned an
ambiguous error (timeout, reset connection, 5xx) — produced an executed
conversion/payout with **no customer debit and no durable record**. A client
retry could then execute the provider a second time, and `executeWithFailover`
happily ran provider B after an ambiguous provider-A error, double-spending.

## Decision

Money moves **debit-first, provider-second**:

- `HoldConversion` — debit source wallet + source-side ledger legs + insert a
  `pending` conversion row, all in one committed transaction. `ApplyTransfer`
  (already atomic) now runs before the provider call with status
  `processing`.
- The provider runs only **after** the hold commits.
- `SettleConversion` — claims the pending row (`FOR UPDATE` + status guard),
  credits the destination wallet, posts destination-side legs, flips to
  `settled` — one transaction, replay-safe.
- `RefundConversion` / `RefundTransfer` — mirrors the source legs and flips
  terminal. Used **only** for definite refusals.
- `CompleteTransfer` — records provider outcome on the held row, guarded
  against overwriting a terminal status (`paid`/`failed`/`reversed`).

### Refused vs unknown provider outcomes

`executeWithFailover` continues to the next provider **only** when
`errors.Is(err, provider.ErrProviderRefused)` — i.e. the provider answered and
refused (4xx/app-level rejection) or the adapter refused before anything was
sent. Maplerad wraps every `!resp.Status` rejection; Eversend wraps HTTP 4xx.

Everything else — timeout, connection reset, 5xx, context deadline — is an
**unknown outcome**: the request may have been accepted upstream. Failover
stops, `codeProviderOutcomeUnknown` is returned, and the caller leaves the
held row `pending`/`processing` for reconciliation (webhook settle/refund or
`Reconcile`).

### Webhooks move money with the status

`HandleProviderEvent` now calls `SettleConversion` (credit dest) on a success
webhook and `RefundConversion` on a failure webhook — a bare status UPDATE
would strand the hold. `SettleConversion` falls back to the stored
`dest_minor` when the webhook carries no amount.

## Consequences

- A replay by idempotency key always finds the durable row and **never**
  re-executes a provider.
- Worst-case failure mode inverts: instead of "paid upstream, no local record"
  we get "debited locally, outcome pending" — visible in `Reconcile` and
  resolvable by webhook or refund. Customer harm is bounded and reversible.
- `pending` conversions are a new intermediate state; UIs reading
  `orch_conversions.status` should treat it as in-flight, not failed.
- Provider-side idempotency keys are still not relied upon — the durable row
  is the replay anchor.

## Alternatives considered

- **Provider-first + outbox:** still leaves the crash gap between provider
  success and outbox write.
- **Two-phase commit with providers:** Maplerad/Eversend expose no
  reserve-then-commit primitive; unavailable.
- **Auto-refund on any error:** unsafe — a timeout after acceptance would
  refund a customer whose payout also landed.
