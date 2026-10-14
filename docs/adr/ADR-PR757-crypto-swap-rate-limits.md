# ADR-PR757: Per-user rate limits on crypto swap quote and confirm

Status: accepted (flag-off, with the swap pipeline) · Closes a gap listed in ADR-PR719.

## Context
Quote and confirm were only bounded in-process (the keyed gate protecting the lock pool). Nothing limited how often
one user could price swaps against the provider or fire confirms. Confirm also spends a PIN attempt and holds funds.

## Decision
- Reuse `middleware.PerUserRateLimit` rather than a new limiter: same Redis fixed-window counter, same envelope
  (`429 {code: rate_limited}`), same headers, and operators already understand it.
- **Two budgets, two prefixes**: quote 20/min (cheap, read-ish, pricing calls the provider) and confirm 5/min
  (moves money, consumes a PIN attempt). Env-tunable, validated 1..600 when the swap pipeline is on, because the
  middleware turns a limit <= 0 into 60/min and would otherwise loosen the budget on a misconfiguration.
- **In front of the handler**, so a throttled confirm never reaches the PIN check. Polling and the provider webhook are
  deliberately outside the budgets: throttling polling would break the client's wait for settlement, and throttling the
  webhook would drop provider callbacks.
- The limiters live on `HandlerDeps` (optional, nil in unit tests) rather than inside the package, so `cryptosvc` does
  not import Redis; the app wiring always sets both.

## Consequences
- **Redis errors fail open** (existing middleware behaviour). During an outage the budget is not enforced; the atomic PIN
  lockout (ADR-PR755), the in-process gate and the lock pool still bound the damage.
- **Bad input spends budget too.** The limiter runs before the handler's cheap rejections, so a malformed id, bad body
  or missing PIN also counts toward the 5/min confirm budget. Limiting later would need a handler-level counter; we
  prefer the simple, strictly-earlier placement. A client that loops on bad input can lock itself out of confirming
  for up to a minute.
- **429 must mean "outcome unknown", not "failed", for clients.** Confirm does not use the Idempotency-Key, so a retry
  after a timeout spends budget; clients should poll the swap rather than treat a throttled confirm as a failure.
  (No client for the new pipeline is on `main` yet.)
- At mount the limits are clamped to at least 1, because non-dev validation does not run in dev and the middleware
  would turn 0 into 60/min.
- Fixed one-minute window: a user can burst up to twice the budget across a boundary.
- Keyed by user id only. IP or device limits are out of scope (IP keying is spoofable behind a proxy).
- Without Redis the limit is per replica, so the effective cap scales with replica count.

## Not covered
Rate limiting of the legacy `/crypto` routes, an admin view of throttling, and per-asset or per-amount velocity limits.
