# Crypto Trading (Quidax) — UAT Execution Run Log

Repository: `/Users/paymax/Desktop/wordpress/spotlight/new`
Branch: `fix/marketplace-voting-admin-followups` · Commit: `160d8313a3d1` · Go: `go1.27.2 darwin/amd64`
Tester: autonomous QA pass (automated suites only; no live-provider, no VAPT, no UI automation run).

## Command 1 — build the three crypto packages
```
cd backend && go build ./internal/crypto/... ./internal/cryptosvc/... ./internal/cryptoprov/...
```
Result: **build-exit 0** (clean).

## Command 2 — non-live automated suite (no DB → live_db tests SKIP)
```
cd backend && go test ./internal/cryptoprov/... ./internal/crypto/... ./internal/cryptosvc/... -v
```
Result: **246 PASS · 35 SKIP · 0 FAIL**. The 35 skips are the `_live_db_test.go` money-path
tests gated on `TEST_DATABASE_URL` (correctly skipped, not failed, with no DB).

## Command 3 — live money-path suite against the local (isolated, non-production) Postgres
The local Supabase dev stack was already running (verified read-only; **no DB was reset**). The
live tests seed synthetic `auth.users` rows and assert on balance *deltas*, so they are safe to run
against the developer's local DB and are exactly what `TEST_DATABASE_URL` gates.
```
cd backend && TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/cryptoprov/... ./internal/crypto/... ./internal/cryptosvc/... -v
```
Result: **281 PASS · 0 SKIP · 0 FAIL**. All 35 live_db tests executed and passed, including:
- `TestLive_ConcurrentConfirmsHoldOnce` — double-spend guard under concurrency
- `TestLive_ConcurrentHoldsForOneSwapPostOnce` — once-only journaling under race
- `TestLive_CompleteAndFailRacingPostExactlyOneOutcome` — exactly one terminal outcome
- `TestLive_BuyHoldThenCompleteConservesMoney` / `TestLive_SellPaysNetAndConserves` — money conservation
- `TestLive_FailedBuyMakesTheUserWhole` — refund integrity
- `TestLive_ReplayWithADifferentAmountFailsClosed` — idempotency safety
- `TestLive_OnlyOneReplicaLeads` / `TestLive_ReconcilerEndToEnd` — reconciler leader lock + recovery
- `TestLive_TierTradeGate` — KYC tier gate; `TestLive_ConcurrentFirstQuotesCreateOneAccount` — subaccount once-only

Schema pre-check (read-only `to_regclass`): `ledger_accounts`, `crypto_swaps`,
`crypto_fee_schedules`, `auth.users` all present (migrations applied).

## Command 4 — NEW deposit settlement (GAP-DEP-01 slice 1) built + verified
Implemented `internal/crypto/deposit` (Settler + PGStore + DBResolver) and additive
migration `20271086000000_crypto_deposits.sql` (applied to the local dev DB, `CREATE TABLE`
only — nothing dropped/reset). Option A realised as a once-only money-IN journal that
atomically upserts the existing `crypto_holdings` projection (no second balance plane, no
DDL on `finance/ledger`).
```
cd backend && go vet ./internal/crypto/deposit/...                       # clean
cd backend && TEST_DATABASE_URL=... go test ./internal/crypto/deposit/... -v
```
Result: **13 PASS · 0 FAIL** (8 domain, 5 live-DB). Proven invariants:
- finality gate (below-threshold / pending / reorged / failed / non-positive → no credit, no row)
- **once-only under a 16-way concurrent same-`provider_op_id` race → exactly 1 settled, 15 duplicate**
- duplicate webhook storm (50×) → credited once; user-leg == custody-leg (conservation)
- cross-tenant isolation (recipient resolved from `crypto_accounts`, never from the event)
- orphan sub-account → Unmapped, credits nobody; resolver outage → error (retry), not silent drop

## Command 5 — deposit settlement WIRE-UP (GAP-DEP-01 slice 2): webhook → re-query → settle
Added the `cryptoprov.DepositProvider` capability (`GetDeposit` re-query + `ListDeposits`) with
Mock + Quidax implementations and `Event.Account`; `deposit.Settler.SettleDeposit` (decimal
whole-units → integer minor units via the resolved scale, same four invariants); `cryptosvc.Ingest`
deposit routing behind an injected `DepositSettler` seam; and the `app` bridge that mounts it on the
existing `/api/v1/webhooks/crypto/:provider` endpoint under `FEATURE_CRYPTO_SWAPS_ENABLED` with a
configurable floor `CRYPTO_DEPOSIT_CONFIRMATIONS` (default 3, validated 1..144). No DDL change; the
swap routing and its tests are untouched.
```
cd backend && go build ./... && go vet ./internal/config/... ./internal/app/...   # clean
cd backend && go test -p 2 ./...                                                  # 262 ok / 0 fail (full suite)
cd backend && TEST_DATABASE_URL=... go test ./internal/crypto/deposit/... -run TestLive -v
```
Result: **+22 new tests green** (8 deposit domain incl. `toMinorUnits`; 6 `cryptosvc` routing; 6
Quidax; 2 deposit live-DB). Proven:
- a `deposit.*` delivery is authenticated, deduped, then **re-queried** — the settled amount/status/
  confirmations come from `GetDeposit`, never the payload (payload with no amount still settles the
  provider's 0.5; a decoy body amount is ignored).
- once-only: same `provider_op_id` → `Settled` then `Duplicate`; the dedupe layer swallows the second
  delivery before the engine runs.
- failure safety: a re-query or engine error returns 5xx and **releases the dedupe row** so the
  provider's retry re-runs it (never a stranded deposit); an unwired engine `Ignored` the delivery.
- live-DB: `0.005 BTC` → **500000** `crypto_holdings` units, journaled once; dust (sub-minor),
  pending, and orphan sub-account all credit nobody.

## New totals with the deposit engine wired (DB attached)
| Scope | Pass | Fail |
| --- | --- | --- |
| existing crypto suites (cryptoprov+quidax+crypto+cryptosvc) | 293 | 0 |
| deposit engine (internal/crypto/deposit) | 23 | 0 |
| **combined crypto** | **316** | **0** |
| **full backend suite (`go test -p 2 ./...`)** | **262 packages** | **0** |
Still **Not Run**: the deposit reconciler (`ListDeposits` exists but nothing polls it for missed /
under-confirmed webhooks) and the admin/mobile deposit surface — so E2E-05/27/29 stay Partial/Blocked
(see gap-backlog slice-2 carry-over + slice 3). **Not run against a live Quidax webhook** (event name /
confirmations field / status vocabulary unverified in the TEST sandbox).


## Coverage summary (automated, this run)
| Package | Build | Tests | Pass | Skip | Fail |
| --- | --- | --- | --- | --- | --- |
| cryptoprov (+quidax) | ok | 50 | 50 | 0 | 0 |
| crypto | ok | all | pass | 0 | 0 |
| cryptosvc | ok | all | pass | 0 | 0 |
| **total (DB attached)** | **ok** | **281** | **281** | **0** | **0** |

## Not run this session (recorded honestly, never as Pass)
- Live Quidax sandbox contract — no permitted credentials (Blocked).
- VAPT (ASVS/API Top10/MASVS), SAST/DAST/SCA — no authorized staging/tooling (Blocked).
- Performance/SLO/soak, chaos/DB-failover/queue-replay — no owner-set SLOs / fault lab (Blocked).
- Mobile live-mode E2E + accessibility — no device/browser lab, backend not exercised end-to-end (Not Run).
- Regression golden-dataset / prior-build diff; privacy/legal (Not Run / Blocked).
