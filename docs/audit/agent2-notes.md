# Agent 2 — backend security/reliability residual notes

Scratch notes for the audit ledger owner (FULL_AUDIT.md is maintained
separately; this file is the hand-off). Worktree: `wt-agent2`.

## Fixed in this lane

### In-memory rate-limiter stores now bounded + swept (AUD-BE-004 / AUD-PERF-002 residuals)

Three process-local fixed-window stores could grow without bound under
attacker-rotated keys:

- `internal/middleware/middleware.go` — `stemRateStore` (the `StemRateLimit`
  middleware guarding every STEM route group). **Never evicted at all**, and
  its key mixed in the caller-set `x-stem-role` request header, so each
  distinct header value minted a fresh bucket — a trivial bypass AND an
  unbounded allocation axis.
- `internal/middleware/middleware.go` — `AuthRateLimiter` (login/register/
  reset). Swept expired buckets on every write but had no hard cap, so a
  key-rotation flood of fresh keys still grew it unboundedly inside one
  window; the per-request O(n) sweep against a huge map was itself a CPU
  amplifier.
- `internal/maps/handler.go` — `memLimiter` (in-memory fallback when Redis is
  absent). Keyed on `user_id` so cardinality is bounded by real users, but
  stale buckets never evicted.
- `internal/health/symptomsearch/handler.go` — `searchLimiter` (in-memory
  fallback). Keyed on `user_id|deviceHash(X-Device-Id)` — the device half is
  caller-controlled, so one authenticated user could rotate `X-Device-Id` and
  grow the map unboundedly while Redis is absent.

Fix shape (same at all four sites): opportunistic sweep of window-expired
buckets gated to at most once per window (no goroutine to leak), plus a hard
key cap — at capacity a new key first reaps expired buckets, then evicts a
batch (~10%) of arbitrary entries via a partial map range, keeping overflow
cost amortized. Behaviour stays fixed-window; a flooded limiter degrades to
slightly looser limiting rather than unbounded memory or fail-closed 429s for
everyone.

`StemRateLimit` additionally dropped `x-stem-role` from the bucket key. The
header has been dead for authorization since ADR-056 (real roles resolve via
`rbac.GetUserRoles`), so it only lived on as a bypass axis.

## Still open (deliberately not fixed here)

- **Per-replica limiter state** (AUD-SEC-001 residual): all in-memory buckets
  reset per instance, so the effective ceiling multiplies by replica count.
  The real fix is a shared Redis limiter on the auth/stem surfaces — the
  pattern already exists (`internal/otp` Postgres limiter, `maps`/`symptomsearch`
  `redisAllow`), but picking the store + key layout is a design decision
  (ADR-worthy), not a drive-by.
- **`symptomsearch` device-hash rotation bypass**: `PerUserDeviceRateLimit`
  keys on `user_id|deviceHash` in BOTH the Redis and in-memory paths, so an
  authenticated caller rotating `X-Device-Id` gets a fresh budget per request
  even with Redis present. The bound added here fixes memory growth only;
  closing the bypass needs a per-user ceiling (second-level aggregation) —
  flagged for the ledger.
- **`getClientIp` XFF trust in `frontend-web`** (AUD-SEC-001 frontend
  residual): out of this lane (frontend).
- **AUD-DB-006** (`update_contestant_vote_stats` repurposed trigger still
  writing `admin_votes` for `contestant_votes` inserts): needs a migration —
  out of this lane.
- **`middleware/per_user_rate_limit.go`**: does not exist on `main` (it lives
  on branch `fix/connect-vote-ratelimit`); nothing to bound. If it merges,
  apply the same sweep+cap pattern.
