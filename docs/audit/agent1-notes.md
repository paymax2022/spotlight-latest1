# Agent 1 — Wallet Balance Read-Path Performance Investigation

Scope: `GET /api/finance/wallet/balance` p95 ≈ 7.96s @ ~1,050 VUs (k6); separate
hung-DB incident → ~30s pool-acquisition delay.

Date basis: worktree `wt-agent1`, branch `fix/agent1-wallet-perf`, base
`origin/main` @ c37a1562.

## Read path traced

`GET /api/finance/wallet/balance`
→ `middleware.RequireAuthContext` (`backend/internal/middleware/auth_context.go:33`)
  = 1 sequential GoTrue `/auth/v1/user` call + 3 **concurrent** PostgREST calls
  (status, roles, permissions — the post-PR#339 shape)
→ `requireUserID` (`finance_routes.go:3382`)
→ `modulegate` middleware (60s-cached registry read — not a hot-path cost)
→ `wallet.Handler.GetBalance` (`internal/finance/wallet/service.go:199`)
→ `ledger.Service.GetBalance` (`internal/finance/ledger/service.go:51`)
→ `repo.GetOrCreateAccount` + `repo.GetBalance` (`repository.go`)

The same path serves `GET /api/v1/wallet/summary` (`wallet_connect_handler.go:66`)
and, with an across-pots variant, `GET /api/finance/admin/wallets/:id/balance`.

## Findings

### AGT1-PERF-001 — Balance read ran a write (upsert) + a second query on every request — FIXED

`Repository.GetOrCreateAccount` executed `INSERT ... ON CONFLICT DO NOTHING
RETURNING` **first** and only ran the SELECT when the insert returned zero rows
(conflict). For an existing account — i.e. ~all steady-state traffic — every
balance read therefore paid a write-shaped statement **plus** a SELECT: 2 RTTs
per request where 1 suffices, doubled pool-connection hold time, and an
unnecessary write on a read-only endpoint (which also makes the path unusable on
a read replica / during a failover when Postgres is in recovery).

Fixed: `getOrCreateUserAccount` / `getOrCreateStandingAccount` now SELECT first
and only INSERT on a genuine miss (`ErrNoRows`), re-selecting after losing a
create race. Race semantics preserved via the existing unique constraints.

Evidence: `repository.go` rewrite; live-DB tracer test
`repository_readpath_live_db_test.go` asserts zero INSERTs on the existing-account
path and exactly-one INSERT on first touch.

### AGT1-PERF-002 — pgx pool had no sizing/timeout surface — FIXED (opt-in knobs)

`internal/platform/db/db.go` built the pool straight from
`pgxpool.ParseConfig(dsn)` with zero overrides:

- `MaxConns` defaulted to `max(4, NumCPU)` — 4–8 connections for the entire API
  on a small container. At 1,050 VUs the queue depth dwarfs the pool.
- No `connect_timeout` applied unless present in the DSN.
- **Nothing bounds pool acquisition**: `Acquire` waits on the request context and
  gin sets no deadline → a hung DB pins every connection and queues every
  request indefinitely. This is the mechanism behind the observed ~30s
  pool-acquisition delay.
- No `statement_timeout` / `idle_in_transaction_session_timeout` → one stuck
  query pins a connection forever.

`db.New` now honors opt-in env overrides (`DB_POOL_MAX_CONNS`,
`DB_POOL_MIN_CONNS`, `DB_CONNECT_TIMEOUT`, `DB_STATEMENT_TIMEOUT_MS`,
`DB_IDLE_TX_TIMEOUT_MS`); unset ⇒ byte-for-byte identical behaviour to before.
Deliberately opt-in rather than defaulted-on: the right `MaxConns` depends on
Postgres `max_connections` and replica count, and a blind `statement_timeout`
could kill legitimately-long cron/reporting queries on the same `db.New` pool
(marketplace-cron/indexer share it). Deployment owners should set, as a floor:

    DB_CONNECT_TIMEOUT=5s DB_STATEMENT_TIMEOUT_MS=15000
    DB_IDLE_TX_TIMEOUT_MS=10000 DB_POOL_MAX_CONNS=<see below>

`DB_POOL_MAX_CONNS` sizing rule: keep `replicas × MaxConns` comfortably below
Postgres `max_connections` minus headroom for supabase services/admin (local
`max_connections=100`; the audit run raised it to 500).

### AGT1-PERF-003 — Balance projection scans the account's full entry set — improved

`balanceProjectionSQL` (`repository.go:120`) sums every `ledger_entries` row for
the account. `idx_ledger_entries_account_id` exists but the query bitmap-scans it
and heap-fetches each row. Measured on the local DB (EXPLAIN ANALYZE, 200k
seeded rows in a rolled-back tx, warm buffers): **Bitmap Heap Scan, 22.4ms** for
one account. Per-user wallets stay small enough for this to be fine, but
standing accounts (`provider_clearing`, `commission`, `settlement`) accumulate
every platform movement — the projection degrades linearly forever.

Fix shipped: migration `20270329000000_ledger_read_path_indexes.sql` adds
`(account_id) INCLUDE (type, amount_kobo)` covering index → index-only scan once
the visibility map settles, plus `(account_id, created_at DESC)` so
`ListEntries`' `ORDER BY created_at DESC LIMIT n` stops after n index rows
instead of sorting the account's whole history.

Note: the ledger-projection rule ("balance = SUM of entries, never a stored
column") is load-bearing, so a cached balance column was deliberately NOT added.
If a standing-account aggregate ever becomes a hot path, the next step is a
periodic rollup/checkpoint *table* read, not a balance column.

### AGT1-PERF-004 — Auth fan-out still dominates request latency — documented, not fixed

Even after PR #339, every authenticated request pays **1 sequential GoTrue
`/auth/v1/user` RTT + a concurrent batch of 3 PostgREST calls** (status, roles,
permissions), with the GoTrue call upstream-bounded at 10s. The audit's own load
verification (AUD-PERF-001 residual, 2026-10-02) recorded ~7.2k upstream 500s on
`/auth/v1/user` during a 200-VU ramp and concluded **GoTrue is the ceiling** —
at 1,050 VUs the balance endpoint's p95 is overwhelmingly this auth path, not
the ledger query (~sub-ms–ms range at realistic account sizes).

Correct fix is JWT-local (HS256) validation with remote checks moved off the hot
path — needs a revocation-semantics ADR; intentionally out of scope here (that's
a design decision, not a drive-by, per the audit itself).

### AGT1-PERF-005 — Two parallel balance paths exist (Next.js vs Go) — AND the Next.js one is heavier

There are TWO live balance reads:

- **Go**: `GET /api/finance/wallet/balance` → pool → upsert-then-SELECT +
  `SUM` projection (see AGT1-PERF-001/003).
- **Next.js**: `GET /api/v1/wallet/balance` (`frontend-web/app/api/v1/wallet/
  balance/route.ts`) → `src/server/wallet/service.ts:getBalance` → a chain of
  ~5 sequential PostgREST round-trips per request:
  1. `getOrCreateAccount` — SELECT `ledger_accounts` (read-first, fine)
  2. `migrateLegacyMobileBalanceIfNeeded` — **`SELECT count(*) exact` over
     `ledger_entries WHERE account_id=$1` on EVERY request** — O(#entries)
  3. `ledger_accounts` select for spendable pot ids
  4. `wallet_balance` view (a `ledger_accounts LEFT JOIN ledger_entries
     GROUP BY` aggregate — predicate pushes down to the user's ≤2 accounts,
     still O(#entries))
  5. a **second identical `count: 'exact'` over `ledger_entries`** to gate
     the `mobile_fintech_accounts` fallback — pure duplicate of step 2
  plus `requireRequestUser` + `requireKycTier` upstream calls on the route.

  The audit's own live-run table records this endpoint returning
  `available_kobo` — the Next.js response shape — so **the measured 7.96s p95
  may well be the PostgREST-fan-out path, not the Go pool path**. Both now
  fixed where safe:

  - step 2 and step 5 are now a single `LIMIT 1` existence check whose result
    (`hasEntries`) is reused for the fallback gate — removes two O(N) scans
    and one whole HTTP RTT per request.
  - Remaining sequential PostgREST calls (account list, view read) are the
    structural residue of AUD-PERF-001's "Supabase REST in the hot path";
    collapsing them needs an RPC or a move of the read to the Go service —
    a design decision, documented not done.

### AGT1-PERF-006 — k6 money-path script hit the WRONG surface for Go — FIXED in script

`infra/loadtest/money-path.js` called `GET /api/v1/wallet/balance`, which the
**Go** router does not register (Connect wallet exposes `/summary`; the finance
wallet exposes `/api/finance/wallet/balance`). If BASE_URL points at the Go API
that is a 404 whose `status < 500` check passes silently; pointed at the Next.js
gateway it measures the PostgREST path instead — either way it was NOT measuring
the Go money-path service the script advertises. Script now hits
`/api/finance/wallet/balance` and fails loudly on 404. Re-run the load test
before/after this PR for real numbers.

### AGT1-PERF-007 — Exact-COUNT existence checks — FIXED (see AGT1-PERF-005)

Covered above: `count: 'exact'` over `ledger_entries` replaced by `LIMIT 1`
existence check in `service.ts`. An exact COUNT(*) scans every matching index
tuple — O(#entries) — while LIMIT 1 is O(1). On a busy account the difference is
two full index scans per request → none.

### AGT1-PERF-008 — No request deadline anywhere in the chain — documented

gin requests carry no deadline; pool acquire, queries, and (post-auth) handler
work are unbounded. Combined with AGT1-PERF-002 this converts DB hangs into
indefinite goroutine growth. Options for a follow-up: a bounded timeout
middleware on money-path groups, or `context.WithTimeout` in repository calls.
Not changed here — a global request timeout is a policy decision (long-running
admin exports exist) and belongs behind an ADR or at least a measured rollout.

## Local evidence gathered

- `ledger_entries`: indexes `pkey`, `idx_ledger_entries_account_id`,
  `idx_ledger_entries_idempotency_key`, `idx_ledger_entries_reference`, unique
  `idempotency_key`. `ledger_accounts`: unique `(user_id,type)` +
  `(user_id,type,currency)` + partial standing-type unique.
- EXPLAIN (ANALYZE, BUFFERS) of the balance SUM, 200k rows/one account: Bitmap
  Heap Scan over `idx_ledger_entries_account_id`, 22.4ms execution, 3,017 buffer
  hits (rolled back after measurement — no fixture data committed).
- Postgres `max_connections=100` locally; pool defaults unchanged by `db.New`.
- Confirmed `INSERT ... ON CONFLICT DO NOTHING` on an existing
  `(user_id,type)` does not emit WAL/dead tuples measurably (PG skips the
  speculative insert when the conflicting tuple is committed-visible) — so the
  AGT1-PERF-001 cost is the extra statement + RTT + write semantics, not bloat.

## PR

- `fix/agent1-wallet-perf` — SELECT-first account resolution, env pool knobs,
  covering/ordering indexes, k6 route fix, live-DB regression tests.
