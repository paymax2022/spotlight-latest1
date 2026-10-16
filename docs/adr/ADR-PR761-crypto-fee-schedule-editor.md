# ADR-PR761: Editable crypto fee schedule — append-only versions, optimistic concurrency, ceiling in code

Status: accepted (flag-off, with the swap pipeline)

## Context
The swap markup (majors 0.75%, other liquid assets 1.00%, higher-risk assets 1.25-1.50%) was hardcoded in
`DefaultFeeSchedule`. Changing a price meant a code change and a deploy, with no record of who changed it or why. The markup
is revenue and a customer-facing price, so an editor must be hard to misuse as well as convenient.

## Decision
- **Append-only versions.** `crypto_fee_schedules` holds one complete schedule per row; a trigger refuses UPDATE and DELETE;
  the active schedule is the highest version, and no row means the configured default. History is evidence, not state.
- **Quotes read the live schedule per request** through a `FeeSource`. We rejected an in-process cache: it would need
  invalidation, make replicas disagree for a window, and the extra indexed read is small next to the provider quote the same
  request already makes. A read error, or a stored schedule above the ceiling, **refuses the quote** (fail closed).
- **A new version never reprices an open swap.** The bps and fee are stored on the swap at quote time and every later step
  (confirm, settlement, reconciler) reads them back. This is why live editing is safe on a money path, and it is tested.
- **Optimistic concurrency.** A write must state the version it read (`expected_version`); the check and the insert run under
  one advisory lock, so of N simultaneous writers exactly one wins and the rest get 409 and must reload. Last-write-wins was
  rejected: two admins editing from stale screens would silently undo each other's price change.
- **The ceiling is code.** `HardMaxBps` (150) bounds every rate and is enforced in the API and again whenever a stored schedule
  is read. The table has only sanity CHECKs, so raising the ceiling is a reviewed change, not something the endpoint can do.
- **Mandatory reason, Idempotency-Key and an atomic audit row.** Every change carries a reason, is replay-safe, and the store
  writes `crypto.fee_schedule.update` (old and new values) to `crypto_audit_log` **in the same transaction as the version row**,
  with the "old" value read under the same advisory lock. An independent review found that auditing from the handler after the
  commit could lose the record if the audit write failed and the client then retried (the replay would skip it); writing it
  in-transaction removes that gap. A replay or a refused write adds no audit row.
- **Stored data is validated on read, not trusted.** Every quote re-checks the schedule: rates within the ceiling, the ceiling
  itself equal to the code's `HardMaxBps`, and every asset code in canonical upper-case form (a lower-case code would never
  match and the asset would silently price at the other-assets rate). The base schedule can never carry a looser ceiling.
- **TRUNCATE is refused** (statement trigger and revoked privilege) because row triggers do not fire for it; the history is
  evidence only if it cannot be emptied.

## Consequences
- Any holder of `crypto.admin` can reprice within [0, 150] bps. We did not add a dedicated permission or a maker/checker rule
  (both need RBAC seeding and a second approver workflow); the change is bounded, audited and reversible by appending a new
  version, and it only affects quotes issued after it.
- Append-only means mistakes are corrected by a new version, never by editing; tests that write to a shared database cannot
  delete their rows and instead append a restoring version.
- Every quote does one extra read of the latest row. If that ever matters, add a short TTL cache keyed on the version.

## Not covered
Recording the schedule version on each swap (provenance for disputes; an additive nullable column), scheduled or future-dated schedules, a per-edit change-size limit, sell-side and order-book fees, an admin UI, and per-user or
per-tier pricing.
