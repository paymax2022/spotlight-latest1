# ADR-050 — Derived rider status is computed in SQL, with the Go function kept as its tested specification

**Status:** Accepted
**Date:** 2026-08-29
**Deciders:** Restaurant & Delivery module

> Written with the `ADR-050` placeholder per `docs/adr/ADR-000-template.md`.
> **141 is not a real pull request** — this work landed by direct push to
> `develop`. See the note in ADR-049 for why, and why 140/141 were chosen.

## Context

A rider's status on the dispatch board — `available | on_delivery | offline |
suspended` — is not a column. It is derived from three inputs by
`mapRiderStatus`: the transport `drivers.status`, `verification_status`, and
whether the rider currently holds a non-terminal order.

That was fine while the roster was a single unbounded `SELECT` that Go post-
processed. It stopped being fine the moment the board needed to **filter, count
and page** by status, because a value produced after the rows come back cannot do
any of those. Filtering a page locally would page one population and filter
another: ask for "available" and you get whichever of the loaded 25 qualify, with
a total describing something else entirely.

The same read had a second, worse problem that motivated looking at it at all.
Its "is this rider still carrying something" subquery asked:

```sql
AND o.status NOT IN ('delivered','cancelled')
```

That list predates `rejected`, `dispatch_failed` and `delivery_failed`. A rider
whose last job ended in any of those three kept it as their *active* order
forever, so `mapRiderStatus` reported `on_delivery` and dispatch would never
offer them another job. Latent on current data — 0 riders affected — but 29
closed orders still hold a rider, so it was one transition from biting. The
identical stale list on the dispatch queue was **not** latent: 183 of 345 board
rows were closed orders no courier could ever be sent to.

## Decision

**1. Express the derivation in SQL (`riderStatusSQL`), and page/filter/count on that.**

```sql
CASE
  WHEN COALESCE(d.verification_status,'approved') IN ('suspended','rejected') THEN 'suspended'
  WHEN act.id IS NOT NULL THEN 'on_delivery'
  WHEN d.status = 'online' THEN 'available'
  WHEN d.status = 'on_trip' THEN 'on_delivery'
  ELSE 'offline'
END
```

`act` is a `LEFT JOIN LATERAL` for the rider's current non-terminal order.
Branch order matters and is asserted: suspension is checked **before**
on-delivery, because a suspended rider holding an order is suspended, not merely
busy, and dispatch must not treat them as working stock.

**2. Keep `mapRiderStatus` deliberately, as the executable specification.**

It has no production caller any more. It is not dead code, and the comment above
it says so, because deleting it would leave the SQL as the only statement of the
rule with nothing to check it against — which is precisely how the terminal-status
list drifted in the first place.

`TestRiderStatusSQLMatchesGo` evaluates both across all 40 combinations of
verification × transport status × on-delivery and requires agreement.

**This is not theoretical.** The test failed on its first run — because the
arguments were passed in the wrong order (`mapRiderStatus` takes
`(transportStatus, verification)`, not the reverse). The SQL was correct; the
test was wrong, and the guard caught the mistake within a minute of existing.

**3. One definition of "closed", shared by every reader.**

`terminalOrderStatuses` / `terminalOrderStatusSQL()` replace three hand-written
copies. `TestTerminalStatusSQLAndGoAgree` asserts the SQL IN-list and the Go
predicate classify every status identically. Rendered as a literal rather than a
placeholder deliberately: it is a fixed, code-owned set containing no caller
input, and inlining it is what lets several queries share one definition instead
of each spelling out its own.

**4. Collapse `adminListRidersFallback`.**

It was a 30-line duplicate of the roster query for rows missing
`service_categories`, and it duplicated the stale terminal list too. It is now
the same builder with `withCategories=false`. Part of why it existed at all:
the main query scanned a nullable `verification_status` into a plain `string`,
so a NULL row errored the whole query into the fallback. That is now `COALESCE`d,
removing the failure mode rather than papering over it.

## Consequences

### Positive
- Status becomes a first-class filter: the roster pages, counts and sorts on it,
  and the board's tiles report the platform rather than the current page.
- One definition of "finished" across the queue, the roster, the order feed and
  the unassigned filter, with a test making divergence a build failure.
- Two duplicate query bodies and one silent NULL-triggered fallback removed.
- Suspension precedence is now asserted rather than implied by statement order.

### Negative / trade-offs
- The rule exists in two languages. That is a real cost, accepted because the
  alternative is either losing server-side filtering or losing the readable
  reference. The cost is bounded by a test that compares them exhaustively.
- `TestRiderStatusSQLMatchesGo` compares Go against a *hand-mirrored* SQL
  evaluator, not against Postgres. It catches semantic drift between the two
  rules, not a typo inside the SQL string. `TestRiderStatusSQLShape` covers the
  latter by asserting each branch appears; a live-DB test would cover both and is
  the natural upgrade.
- `mapRiderStatus` now looks like dead code to any tool that does not read
  comments. A coverage or lint pass may flag it.

### Risks
- Adding a branch to the CASE without adding it to the mirror leaves the test
  passing while the two diverge. The mirror is kept adjacent to the constant, and
  the shape test fails on an unrecognised structure, but this is the seam to
  watch.
- The status expression is evaluated per row and cannot use an index. At 174
  riders the roster page measures ~1.1ms; at a much larger driver pool a
  materialised or trigger-maintained column becomes the better trade.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep deriving in Go, filter/page in Go | Cannot page correctly: you would page one population and filter another, and every count would describe the loaded page while appearing to describe the platform. |
| Store `status` as a real column on `drivers` | It depends on live order state, so it needs a trigger or a job to stay true, and a stale row makes dispatch offer work to a rider who is mid-delivery. Deriving it is correct by construction. |
| Delete `mapRiderStatus`, SQL only | Leaves no reference to test the SQL against. The drift this ADR exists to prevent is exactly what happened when a rule had only one, unchecked, spelling. |
| Keep Go only, add a materialised view | More moving parts and a refresh cadence to get wrong, for a 174-row table. |
| Duplicate the terminal-status list per query (status quo) | Already demonstrated to fail: three copies, two stale, 183 of 345 board rows wrong and a latent rider-pinning bug. |

## Related

- `backend/internal/restaurant/admin_dispatch.go` — `riderStatusSQL`, the paged roster and queue
- `backend/internal/restaurant/admin_repo.go` — `mapRiderStatus`, kept as the specification
- `backend/internal/restaurant/admin_orders.go` — `terminalOrderStatuses`, `terminalOrderStatusSQL()`
- `backend/internal/restaurant/admin_dispatch_test.go` — `TestRiderStatusSQLMatchesGo`, `TestRiderStatusSQLShape`
- Sibling: ADR-049 (user-scoped order socket)
