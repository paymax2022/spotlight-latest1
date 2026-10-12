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

## Hardening from the independent audit (no blockers)
- **Rotation:** a swap still in the same state after a pass (provider pending, an errored repair, a timeout) is
  touched so it moves to the back of the age-ordered queue and cannot starve newer stale swaps.
- **Bounded per swap:** each repair has a deadline (`HandleTimeout`, default 30s) so one hung swap cannot stall
  the pass; the lock wait honours it.
- **Safe alerts:** a faulty alert sink (panic) cannot abort a pass.
- Liveness is the per-swap lock, not `updated_at`: the reconciler waits behind a live Confirm and re-reads.

## Operational requirements (not enforced in code)
- The lock DSN must be a **direct or session-mode** connection: advisory locks are session-scoped and silently do
  nothing behind a transaction-mode pooler (PgBouncer).
- Size the lock pool as `2 x concurrent confirms + 3` (the leader holds one connection for the whole pass, each
  repair another, the settler's nested lock a third).
- The staleness cutoff uses the application clock against the database's `updated_at`; keep clock skew well under
  the 2-minute confirming threshold (NTP).
- A swap whose repair keeps erroring is rotated and alerted every pass but not auto-escalated; add an attempt
  counter and park-after-N before enabling.

## Consequences
- `needs_review` swaps with no provider swap id still need a provider lookup by quote id or an admin release action;
  until one exists the feature flag stays off.
- Nothing schedules `Reconciler.Run` yet; wiring (own lock pool, alert sink, interval) belongs to the wiring slice.
