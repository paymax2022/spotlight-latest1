# ADR-PR716: Crypto reconciler — repair what crashes and lost webhooks leave behind

Status: accepted (flag-off, no caller yet)

## Context
The buy pipeline (ADR-PR710) and webhook ingest (ADR-PR708) are individually crash-safe but leave
swaps parked mid-flight when a process dies or a webhook never arrives. Spec 8.4 requires a safety net.

## Decision
- **Single leader.** A Postgres session advisory lock (`PGLeader`) elects one working replica; running with no
  leader lock is an error, never a fallback to "run anyway".
- **Same lock as Confirm.** Each repair runs under the per-swap `confirm:<id>` lock and re-reads the swap,
  re-checking state and staleness, so a live Confirm or a webhook that wrote in the meantime is never overridden.
- **Provider state wins.** Swaps with a provider swap id are re-queried and applied via `Ingest.ResolveSwap`
  (ledger first, state last), exactly as the webhook path does.
- **Never re-execute, never refund the unknown.** The reconciler never calls `ConfirmSwap`. A confirming swap
  stale for 2 minutes whose provider call was **never attempted** is safe to release (nothing executed). One whose
  call **was** attempted (or a processing swap with no id) has an unknown outcome and is parked in `needs_review`
  with the hold kept, and an alert is raised.
- **Quotes** unconfirmed past expiry + grace are expired.
- **Failures are local.** One bad swap does not abort the batch; a failed repair leaves the swap for the next pass.
- **Clearing watch.** A negative `crypto_clearing` balance (sells paid before treasury funded the mirror) alerts.

## Consequences
- `needs_review` swaps with no provider swap id still need a provider lookup by quote id or an admin release action;
  until one exists the feature flag stays off.
- Nothing schedules `Reconciler.Run` yet; wiring (own lock pool, alert sink, interval) belongs to the wiring slice.
