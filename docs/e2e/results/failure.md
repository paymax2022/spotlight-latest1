# FAILURE/RECOVERY — deliberate fault injection on the local stack

Date: 2026-10-03. Each dependency was killed/paused live, observed, then restored
and verified before the next scenario. Stack at test time: api
`spotlight-latest1-api-1` :8080, redis `spotlight-latest1-redis-1` :6379,
Supabase suite (`supabase_db_spotlight` :54322, GoTrue behind kong :54321),
web `next dev` :3000, fakes :9101. No worker processes run locally (BE-031).

Test identities (throwaway, this run only): sender `fsnd-1791036918@paymax.test`
(`cf8979ae-…65ad`, tier 1, funded 500,000 kobo via the standard
provider_clearing→user_wallet fixture journal) and receiver
`frcv-1791036918@paymax.test` (`ae2a78f7-…6d46`). Money rail exercised:
`POST /api/finance/transfers/paymax` (₦100 baseline → 201 before any injection).

Final state after all scenarios: every container restored, `/readyz`=200,
money read 200, sender projection == sum-of-ledger-entries (476,000 kobo),
fixture `qa-claude-test` lockout counter back to 0.

## Verdicts

| # | Injected fault | Verdict |
|---|----------------|---------|
| 1 | `docker stop` api | **PASS** — BFF returns clean JSON 504 in ~64ms (ECONNREFUSED short-circuits the 20s bound); `/login` and `/` render 200; no stack leak, no hang |
| 2 | `docker stop` redis | **PASS** — login 200; transfer completes AND replay dedupes (idempotency is DB-enforced, Redis is fast-path only); asynq enqueue failure silently swallowed (see FR-3); readyz does not probe Redis (see FR-2) |
| 3 | `docker stop` postgres | **PASS** — readyz 503 `not_ready`, healthz stays 200; authed GET 503; money POST refused at auth gate; **zero partial ledger legs**; recovery in ~2s |
| 4 | `docker stop` gotrue | **PASS WITH P2 FINDING FR-1** — existing bearer → 503 fail-closed (AUD-BE-002 holds); but login → **401 "invalid credentials"** for a CORRECT password and burns lockout budget |
| 5 | duplicate/replay + api restart mid-replay | **PASS** — parallel same-key POSTs → exactly 1 journal (UNIQUE-constraint race resolves loser into `already_processed`); restart-mid-flight → ≤1 transfer row per key, no half-posted journals |
| 6 | `docker pause` api (frozen upstream) | **PASS** — BFF bounds the stall at exactly 20.1s → clean JSON 504; unpause recovers instantly |
| 7 | no notification-worker running | **CONFIRMED silent-rot** — enqueue returns success to caller, task rots in `asynq:{default}:pending` forever (114 rotting before my probe, 115 after) |

## Scenario evidence

### 1. API down
- `docker stop spotlight-latest1-api-1` → :8080 connection refused.
- Web pages: `GET :3000/login` → 200 (23.6KB, normal SSR); `GET :3000/` → 200
  (97.7KB — homepage data comes from Supabase REST, which is unaffected; the
  Go API outage is invisible to these pages).
- BFF proxied authed call `GET :3000/api/finance/transfers/paymax/resolve?phone=…`
  → **HTTP 504 `{"success":false,"error":"The upstream service could not be reached."}`**
  in **64ms** — fail-fast on connection refusal, no stack trace, no timeout hang.
- `POST :3000/api/auth/login` → **504 `{"error":"The sign-in service could not be reached."}`**
- Restore: `docker start` → `/readyz` 200 in ~2s; money read
  (`transfers/paymax/resolve`) → 200 with correct recipient row.

### 2. Redis down
- `docker stop spotlight-latest1-redis-1`.
- `POST /api/auth/login` → **200** (login does not depend on Redis).
- `POST /api/finance/transfers/paymax` (key `fail-redis-key-1`, ₦50) → **201**.
  Replay same key → **200 `already_processed:true`**, same transfer id;
  `count(wallet_transfers WHERE idempotency_key=…)=1`; balance moved exactly
  once (490,000→485,000). Idempotency is enforced by
  `wallet_transfers.idempotency_key UNIQUE` + replay-first SELECT
  (`internal/finance/transfers/service.go:222-226`), never by Redis —
  `internal/app/router.go:480-482` documents Redis as "a latency optimization,
  never a correctness dependency." **No fail-open double-post risk.**
- asynq enqueue with Redis down: estate ban-resident call → **HTTP 200
  `{"banned":true}`** while api logs show a go-redis dial retry storm
  (`failed to dial after 5 attempts: lookup redis … no such host`, ~1.9s added
  latency). The `notification:push` enqueue **failed and was silently
  swallowed** — notification dropped entirely, not even queued (FR-3).
- `/readyz` → **200 while Redis down** — readiness only pings Postgres (FR-2).
- Restore: `docker start` → PONG; replayed key → `already_processed` dedupe ✓.

### 3. Postgres down
- `docker stop supabase_db_spotlight` (note: also takes GoTrue/PostgREST auth
  resolution down — they share this Postgres; blast radius is combined).
- `GET /readyz` → **503 `{"status":"not_ready","reason":"database ping failed"}`**
  (cached verdict ≤2s old; `internal/handlers/admin_overview.go:364-387`).
  `GET /healthz` → 200 — correct liveness/readiness split.
- Authed `GET …/resolve` → **503 `{"success":false,"error":"authentication service unavailable"}`**
  (fails at `RequireAuthContext`, never reaches handler).
- Money POST (key `fail-dbdown-1`) → **same 503, refused**.
- Post-restore DB check: `wallet_transfers` rows for key = **0**,
  `ledger_entries` rows for key = **0** — no partial legs, no orphans.
- Restore: readyz 200 in ~2s; reads 200; earlier committed transfer intact
  (`successful|5000`); sender projection == ledger sum.

### 4. GoTrue down
- `docker stop supabase_auth_spotlight` (kong stays up, returns 503 upstream).
- Existing valid bearer on authed route → **503 `authentication service
  unavailable`** — `RequireAuthContext` fails CLOSED on transport error
  (`internal/middleware/auth_context.go:42-51`, AUD-AUTH-001). Money mutation →
  same 503, refused before the handler. No fail-open. ✓
- **BUT** `POST /api/auth/login` with the correct fixture password →
  **HTTP 401 `{"error":"invalid credentials"}`** — kong's upstream-down 503 is
  folded into the generic credential failure (`internal/services/auth_service.go:
  367-389` treats ANY `resp.StatusCode >= 400` as definitive auth failure).
  Worse: the same branch calls `bumpFailedLogin` — verified
  `platform_users.failed_login_attempts` went **0→1 for a correct password**.
  With `AUTH_MAX_FAILED_LOGIN_ATTEMPTS` default 5 (`internal/config/config.go:662`),
  five retries during an IdP outage locks a paying user out, and every retry
  burns budget on a gate they cannot see. The code comment at
  `auth_service.go:374-377` describes exactly this hazard ("The password was
  CORRECT — only verification is missing… locks the account out") but the
  carve-out only covers `email_not_confirmed`, not upstream 5xx/transport-via-kong.
  **FR-1, P2.**
- Restore: login → 200, authed route → 200; the successful login reset the
  counter to 0.

### 5. Duplicate/replay under API restart
- Two parallel same-key POSTs (key `fail-par-1`, ₦30): both returned
  **200 `already_processed:true` with the SAME transfer id** — neither got 201.
  One transaction won the `wallet_transfers.idempotency_key` UNIQUE race; the
  loser's INSERT conflicted and it fell through to the replay lookup and
  returned the winner's row. `count=1`, exactly one journal, no double-debit.
- Three restart-mid-flight attempts (`docker restart` ~30ms after POST):
  - #1: request completed **201** before kill (graceful drain) → later replay
    would dedupe; count=1.
  - #2: client got clean **connection refused** (request never landed) → retry
    → **201 fresh execution**; count=1.
  - #3: request completed **201** → retry → **200 `already_processed`**; count=1.
  Every interleaving converges on **≤1 `wallet_transfers` row per key and a
  single balanced journal** — commit-before-kill replays, rollback-before-kill
  re-executes cleanly. No torn state observed or possible at this seam.
- Post-test integrity: `wallet_balance` projection == `sum(ledger_entries)` ==
  476,000 kobo for the sender; zero unbalanced `ww-%` references in the window.
- Minor observation: during a restart, `/readyz` can answer 200 from the
  *draining* process while the new process hasn't bound the port yet — a ~1s
  gap where a ready-verdict'd target still refuses connections. Cosmetic.

### 6. Slow upstream
- `docker pause spotlight-latest1-api-1` (frozen process: TCP accepts at the
  kernel, zero bytes back — the worst kind of "slow").
- BFF call through :3000 → **HTTP 504 `{"success":false,"error":"The upstream
  service did not respond in time."}` at exactly 20.1s**
  (`PROXY_TIMEOUT_MS=20000`, `frontend-web/src/lib/go-backend.ts:28,118-147`).
  Bounded, greppable, clean JSON. Unpause → readyz 200 immediately, traffic resumes.
- Note: direct :8080 callers have no server-side bound (standard for Go
  services) — the client MUST self-timeout. The BFF bound is the one that
  protects real browser/mobile callers, and it works.

### 7. Worker absence (known gap BE-031 — failure-mode confirmation)
- Baseline: `LLEN asynq:{default}:pending` = **114** — all `notification:push`
  tasks from earlier e2e runs (order-confirmed, restaurant-approved…), rotting;
  sampled `pending_since` hours old. `SMEMBERS asynq:queues` = `{default}` only.
- Live trigger: created estate (201), added receiver as resident (201), banned
  them → caller got **HTTP 200 `{"banned":true}`** and pending grew to **115**;
  head-of-queue task `059a6955…` = `notification:push` for the receiver
  ("Account banned"). The enqueue "succeeds" — the task will simply never be
  consumed. No dead-letter, no age alerting, no surfacing anywhere.
- **Confirmed: the failure mode is silent-rot.** For a notification this is
  acceptable-by-design (fire-and-forget side channel); the finding is that
  enqueue success is indistinguishable from delivery success, and nothing
  watches queue depth. P3 — consistent with BE-031, not a regression.

## Findings

- **FR-1 — P2 (dishonest degradation): GoTrue outage → login lies and burns
  lockout budget.** Kong answers the API's `POST /auth/v1/token` with a 503
  while GoTrue is down; `authService.LoginUser` folds any `>=400` (not just
  GoTrue's definitive 4xx rejections) into `invalid credentials` 401 AND
  increments `failed_login_attempts`. Verified live: correct-password login →
  401, counter 0→1. Blast radius: during an IdP outage, every real user who
  retries 5× (default `AUTH_MAX_FAILED_LOGIN_ATTEMPTS=5`) gets
  `platform_users`-locked and cannot self-recover — the outage converts into a
  mass lockout. Fix shape: treat upstream 5xx/transport distinctly — return 503
  and skip `bumpFailedLogin` (the `email_not_confirmed` carve-out at
  `auth_service.go:378-380` is the existing precedent for "don't count what
  isn't a credential failure"). Evidence: `internal/services/auth_service.go:362-389`.

- **FR-2 — P3 (observability gap): `/readyz` does not probe Redis.** Readiness
  only does `pool.Ping` on Postgres (`admin_overview.go:376-377`); a Redis-only
  outage reports fully ready. Defensible — Redis is "never a correctness
  dependency" (`router.go:482`) — but an orchestrator would keep routing traffic
  to a pod whose queue, SSE fan-out, and idempotency fast-paths are all dead.
  Consider a degraded-component field in the readyz body.

- **FR-3 — P3 (silent side-effect loss): notification enqueue failures are
  swallowed.** With Redis down, `EnqueueContext` fails after a ~1.9s retry
  storm and the error is dropped (`_ = notifSvc.Send`,
  `internal/app/finance_routes.go:1200`; the estate/restaurant/invest adapters
  all treat it as best-effort). Caller sees 200; the notification is neither
  queued nor delivered. Same end-state as the worker-absence rot above — from
  the caller's seat, "notification sent" never means anything. Acceptable for
  push, but the pattern is invisible to operators (no metric, no WARN log on
  the swallowed error observed in `docker logs` beyond the go-redis dial noise).

## Stack status on exit
All injected faults reversed. `docker ps`: api/redis/db/auth/kong/web all Up;
`/readyz` 200; money read 200; `failed_login_attempts` reset to 0 by the
post-restore login. Pre-existing non-running containers
(`supabase_edge_runtime_spotlight`, `paymax-redis`, `spotlight-redis`, …)
were exited before this session and left untouched.
