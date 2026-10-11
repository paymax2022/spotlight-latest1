# ADR-PR708: Crypto webhooks dedupe on a PK row, re-query the provider, and release the row on failure

Status: accepted (flag-off, no routes yet)

## Context
Providers redeliver webhooks and may deliver them before our own confirm response is stored,
concurrently with the user request and the future reconciler. A webhook body is
attacker-influenced until its signature is checked, and even a signed body reports state
the provider can later revise.

## Decision
1. **Dedupe by primary key.** `crypto_webhook_events.key` is the guard; `INSERT ... ON CONFLICT DO NOTHING`
   decides atomically which of several concurrent deliveries processes.
2. **Never release value from the payload.** The swap state is re-read from the provider by id
   (`GetSwap`), using the account id stored on *our* row, and only that result drives a transition.
   The event type only routes to the swap path (`swap_transaction.*` and `trade.*` are both accepted until
   the sandbox shows the real name); a mis-route costs one read.
3. **Conditional transitions.** `UPDATE ... WHERE status = from`, validated against the swap FSM
   first. A lost race to a terminal state is success; to a non-terminal state it is a retryable error.
   `confirming` walks through `processing`; terminal states never regress.
4. **Release the dedupe row on failure**, on a context detached from request cancellation, so the provider's
   retry re-runs. If the release itself fails, return `ErrDedupeNotReleased` (page someone); the
   reconciler (later slice) is the safety net for the stranded swap.
5. **Fail closed on amounts.** `completed` with a non-positive amount moves to `needs_review`.
6. A swap event for a provider swap we have not stored yet is `ErrSwapNotRecorded` and releases the row.

## Not decided here
Ledger posting on completion, routes, the reconciler, deposits and withdrawal events. Settlement will
post from the `completed` transition using deterministic `crypto:swap:<id>:*` keys.

## Consequences
At-least-once delivery becomes effectively-once application. The cost is one provider read per
swap event, bounded by the provider rate budget in the Quidax client.
