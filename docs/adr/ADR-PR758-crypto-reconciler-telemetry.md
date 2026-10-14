# ADR-PR758: Reconciler telemetry — per-replica status plus a database backlog rollup

Status: accepted (flag-off, with the swap pipeline) · Closes a gap listed in ADR-PR719 ("a real alert sink", reconciler visibility).

## Context
The reconciler (ADR-PR716) repairs stuck swaps but reported only to the log. Ops could not tell whether it was alive, which
replica led, what its last pass did, or how much money was waiting on it, without reading logs on every replica.

## Decision
One read-only `GET /admin/crypto/reconciler` (crypto.admin) with two deliberately different data sources:
- **`replica`**: counters the `Reconciler` records itself in process (passes, led vs skipped, last result/error, totals, a bounded
  ring of the last 50 alerts). Recording happens inside `RunOnce` and `alert`, so it cannot be skipped by a caller and works
  with no alert sink. It is honest about its limits: per replica, reset on restart, and the response carries a note saying so.
- **`backlog`**: a single read-only SQL rollup over the open states (needs_review, confirming, processing, quoted), giving count,
  held kobo and oldest age. Because it reads the database it is identical on every replica and survives restarts; it is the
  signal that matters ("is money stuck?"), whereas `replica` explains whether the repair loop is healthy.

Alternatives rejected:
- **Persist run history in a table**: a fleet-wide history, but it needs a migration, retention, and a write on every pass of
  every replica, for a job that runs every 30 s. Not worth it before anyone asks for history.
- **Expose it via Prometheus only**: no metrics stack is wired for this module, and the admin console is where ops look.
- **Return the swaps themselves**: the review queue already does that for parked swaps; telemetry returns counts and kobo only,
  and a test asserts no swap, user or provider identifier appears.

## Consequences
- Behind a load balancer, repeated calls may hit different replicas and show different `replica` blocks; the note says so.
  A leader election outage shows as every replica skipping or erroring while `backlog` ages.
- Alert history is lost on restart. The log sink is unchanged and remains the durable record.
- `Store` gains `Backlog`; any new `Store` implementation must provide it. `HandlerDeps` gains `Recon` (nil answers 503).
- The rollup is a full group-by over open rows only (`status IN (...)`), cheap while open swaps stay few; revisit if the
  table grows large without an index on status.

## Not covered
A persisted fleet-wide history, an alert sink other than the log, staleness thresholds in the response, and an admin UI tab.
