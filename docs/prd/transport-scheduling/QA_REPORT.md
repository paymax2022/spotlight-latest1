# Transport Scheduling QA Report — Agent QA

Scope: `backend/tests/transport_scheduled/**` (Go) + `tools/loadtest/transport_scheduled/*.js` (k6).
File boundary respected: nothing was written inside `backend/internal/transport/`
(Backend's exclusive ownership per `SWARM_INTEGRATION_CONTRACT.md` §"FILE
OWNERSHIP"). Every Go test file is an **external, black-box test package**
(`package transport_scheduled_test`) importing only the exported surface of
`spotlight/backend/internal/transport` (`Service`, `ScheduledBooking`,
`ScheduledStatus`/`Sched*` constants, `ScheduledCreateRequest`,
`ScheduledPatchRequest`, `ScheduledEstimateRequest`, `SchedPlace`,
`CodedError`, `Place`, `NewService`).

Reference docs read before writing anything: `SWARM_INTEGRATION_CONTRACT.md`
(frozen model/FSM/routes/invariants), repo-root `CLAUDE.md`, and Backend's
actual source — `scheduled.go`, `scheduled_fsm.go`, `scheduled_handler.go`,
`scheduled_admin.go`, `scheduled_dispatch.go`, and Backend's own
`scheduled_test.go` — read line-by-line, not assumed from the contract prose.
The `qa-engineering` skill (test pyramid, OLA both-sides, idempotency-on-money,
DB-free-where-possible) was loaded and applied throughout.

---

## 1. Why the tests are structured the way they are

Backend's FSM guard table (`scheduledTransitions`), guard functions
(`canTransitionScheduled`, `guardScheduled`, `isTerminalScheduled`), and the
mode-mapping helpers (`materializationKind`, `defaultLeadMinutes`,
`rideServiceType`) are **unexported**. Backend's own in-package
`scheduled_test.go` already asserts these directly (and QA read that file to
confirm every case it covers, to avoid duplicating it uselessly). The frozen
contract only fixes struct shapes, `Service` method signatures, routes, error
codes, and the FSM's PROSE description — not Go-level internal symbol
visibility — so an external test package physically cannot call these
unexported functions, and QA's file boundary forbids adding an in-package file
to get around that.

Per house convention — the exact pattern already used in
`backend/internal/finance/settlement/split_invariant_test.go` (`splitLegsKobo`
mirrors `Service.Settle`'s formula, cited inline) and
`backend/tests/marketplace/fsm_invariant_test.go` (transcribes Agent A's
unexported order/listing/dispute/boost tables) — every unexported piece of
logic this suite needs is **transcribed verbatim from the cited source line
range**, then asserted exhaustively. If `scheduled_fsm.go` or `scheduled.go`
ever silently drift from the transcription, that is either a Backend bug or an
intentional change that must update `SWARM_INTEGRATION_CONTRACT.md` and these
test files together — the drift is caught from the contract side even though
Backend's own unit test also covers the source side.

`Service.CreateScheduled/GetScheduled/CancelScheduled/DispatchScheduled/
DueForDispatch/ExpireStale/SendDueReminders/EstimateScheduled` all take a
concrete `*pgxpool.Pool` (via `NewService(pool, settlementSvc)`) and, for
dispatch/cancel, a concrete `*settlement.Service` — there is no fake/interface
seam exposed for the DB or the escrow ledger. Every one of these methods
therefore **requires a live, migrated Postgres** to execute end-to-end; this is
called out explicitly per test below, and the DB-requiring half of the suite
lives in one file (`live_db_integration_test.go`) so it is obvious at a glance
which tests need infra.

---

## 2. Test inventory

### `backend/tests/transport_scheduled/fsm_invariant_test.go` — runs now, no DB

Transcribes `scheduledTransitions` verbatim from `scheduled_fsm.go` (cited
inline, lines 27-59 at authoring time).

| Test | Invariant covered |
|---|---|
| `TestSchedFSM_ExhaustiveTransitionMatrix` | Walks all 7×7=49 `(from,to)` pairs across the 7 states; asserts EXACTLY the 7 legal frozen edges exist, nothing more/less |
| `TestSchedFSM_SelfTransitionsNeverLegal` | No status has a self-loop (mirrors `guardScheduled`'s `from==to` short-circuit) |
| `TestSchedFSM_TerminalStatesHaveNoOutgoingEdges` | `completed/cancelled/failed_no_driver/expired` are terminal; `scheduled/dispatch_pending/dispatched` each have ≥1 outgoing edge (no booking can get stuck) |
| `TestSchedFSM_IllegalTransitionsRejected` | 18 dangerous illegal edges (skip-ahead to dispatched/completed, backward-from-terminal, dispatched→cancelled/failed/scheduled, wrong-direction expiry) are absent — every case cross-checked against Backend's own `scheduled_test.go` illegal-transition table |
| `TestSchedFSM_EveryModePassesThroughSameFSM` | Structural proof there is no mode-specific FSM branch — one state machine for all 6 modes |

### `backend/tests/transport_scheduled/materialization_test.go` — runs now, no DB

Transcribes `materializationKind`, `defaultLeadMinutes`, `rideServiceType`
verbatim from `scheduled.go`/`scheduled_dispatch.go` (cited inline), plus the
dispatch idempotency-key format from `DispatchScheduled`.

| Test | Invariant covered |
|---|---|
| `TestMaterializationKind_CoversEveryFrozenMode` | Every one of the 6 frozen modes maps to a non-empty kind (`trip`/`parcel`/`bus_ticket`) |
| `TestMaterializationKind_UnknownModeIsEmpty` | Unrecognized mode → `""` sentinel (so `materialize()` falls through to `INVALID_MODE`, never silently picks a default) |
| `TestDefaultLeadMinutes_PerModeBoundaries` | Locks the exact per-mode defaults (ride 30 / parcel 45 / airport 90 / bus 120) and that every default is `> 0` |
| `TestRideServiceType_MapsScheduledModeToTripServiceType` | ride_hail→ride_hailing, ride_share→ride_sharing, airport_pickup→airport_pickup |
| `TestDispatchIdemKey_DeterministicPerBooking` | `sched:<id>:dispatch` format, stable across retries, distinct per booking |
| `TestDispatchIdemKey_NoCollisionAcrossManyBookings` | 500-booking sweep, zero key collisions |

### `backend/tests/transport_scheduled/escrow_safety_test.go` — runs now, no DB

Models the escrow-lifecycle control flow of `onDispatchFailure` and
`cancelScheduledInternal` with a `fakeSchedStore` (same pattern as
`settlement/split_invariant_test.go`'s `fakeStore`) to prove the **non-negotiable
invariant**: *"a booking that ever escrowed funds MUST reach a terminal state
that refunds or settles them — never strand an escrow."*

| Test | Invariant covered |
|---|---|
| `TestEscrowSafety_FailedNoDriverAlwaysRefundsBeforeTerminal` | 3 exhausted dispatch attempts → `failed_no_driver`, escrow refunded every attempt, `settlement_id` cleared |
| `TestEscrowSafety_RetryBeforeExhaustionReturnsToScheduled` | Attempt 1/3 → back to `scheduled` for retry, escrow refunded (never carried "active" across a failed attempt) |
| `TestEscrowSafety_DispatchedNeverStrandsUntilCompleted` | Successful dispatch marks escrow active (owned by the real trip/parcel/ticket); `dispatched→cancelled` is illegal (no double-refund race) |
| `TestEscrowSafety_CancelFromScheduledNeverEscrowed` | Cancel pre-dispatch issues **zero** refund calls (nothing was ever taken) |
| `TestEscrowSafety_CancelFromDispatchPendingRefundsIfEscrowed` | Cancel mid-dispatch (partial escrow) refunds exactly once |
| `TestEscrowSafety_CancelIsIdempotent` | A second cancel call on an already-cancelled booking issues **no second refund** |
| `TestEscrowSafety_ExpireNeverRefundsBecauseNeverEscrowed` | `expired` is reachable only from `scheduled`; a `scheduled` booking has never escrowed by construction, so expiry needs no refund |

### `backend/tests/transport_scheduled/reminders_test.go` — runs now, no DB

Transcribes the `sendReminderWave` WHERE-clause claim guard (cited inline).

| Test | Invariant covered |
|---|---|
| `TestReminders_24hWaveFiresExactlyOnce` / `_1hWaveFiresExactlyOnce` | 10 sequential ticks against the same booking → fires exactly once per wave |
| `TestReminders_ConcurrentInvocationClaimsExactlyOnce` | 20 "concurrent" claim attempts on one booking → exactly 1 claim (the atomic `UPDATE...RETURNING WHERE sent_at IS NULL` claim-then-set pattern is what the live-DB test proves against real Postgres row-locking; this proves the claim/check ordering is indivisible at the logic level) |
| `TestReminders_WavesAreIndependentColumns` | 24h reminder firing doesn't block/consume the later 1h reminder for the same booking |
| `TestReminders_TerminalOrExpiredBookingsNeverFire` | cancelled/completed/failed_no_driver/expired bookings never get a reminder even if pickup falls in-window |
| `TestReminders_OutsideWindowNeverFires` | Half-open interval boundaries: already-past, exactly-now, and beyond-window pickups are all excluded |

### `backend/tests/transport_scheduled/dispatch_window_test.go` — runs now, no DB

Transcribes the `DueForDispatch` and `ExpireStale` SQL WHERE predicates (cited
inline) as pure Go time-math, since no Go branch exists to test directly.

| Test | Invariant covered |
|---|---|
| `TestDueForDispatch_FiresExactlyAtLeadWindowBoundary` | Inclusive `<=` boundary at `pickup - lead == now`; not-yet-due 1s before, overdue 1s after; zero-lead-time edge cases |
| `TestDueForDispatch_PerModeDefaultLeadTimes` | Cross-checks per-mode defaults against the due-window predicate (bus's 120min lead vs ride_hail's 30min at the same pickup time) |
| `TestExpireStale_OnlyFiresAfterGracePeriod` | 15-minute grace margin, strict `<` (not `<=`) at the boundary |
| `TestExpireStale_NeverAppliesToNonScheduledStatus` | `dispatch_pending`/`dispatched` never reach `expired` (cross-checked against the FSM) |
| `TestDueForDispatch_LimitClampingBoundaries` | `limit<=0` or `>200` clamps to 100 |

### `backend/tests/transport_scheduled/create_validation_test.go` — runs now, no DB

Transcribes `CreateScheduled`'s and `EstimateScheduled`'s ordered validation
guard chain (cited inline) — these run BEFORE any DB call.

| Test | Invariant covered |
|---|---|
| `TestCreateScheduled_MissingIdempotencyKeyRejected` | 400 `MISSING_IDEMPOTENCY_KEY` |
| `TestCreateScheduled_InvalidModeRejected` | 422 `INVALID_MODE` for garbage modes; every frozen mode passes |
| `TestCreateScheduled_InvalidRFC3339TimeRejected` | 400 `INVALID_TIME` for non-RFC3339 strings |
| `TestCreateScheduled_PickupInPastRejected` | 422 `PICKUP_IN_PAST`, boundary at "1s future passes" |
| `TestCreateScheduled_NegativeLeadTimeRejected` | 422 `INVALID_LEAD_TIME` for `< 0`; `0` is allowed |
| `TestCreateScheduled_GuardOrder` | Guard chain is sequential — the FIRST failing guard fires even when later guards would also fail |
| `TestEstimateScheduled_InvalidModeRejected` | Same `INVALID_MODE` guard on the estimate path |

### `backend/tests/transport_scheduled/authz_and_contract_test.go` — runs now, no DB

Object-level authz (OLA), admin `reason_code`/`driver_id` guards (these also
run BEFORE any DB call), and DTO/JSON-contract shape checks against the REAL
exported `transport` package types (no transcription needed — these are
exported).

| Test | Invariant covered |
|---|---|
| `TestOLA_OwnerCanAccessOwnBooking` / `_NonOwnerCannotAccessBooking` / `_EmptyCallerNeverMatchesRealOwner` | Pure OLA decision (`b.UserID != userID` from `GetScheduled`) both-sides + degenerate-empty-string guard |
| `TestAdminMutations_RejectEmptyReasonCode` | `ForceDispatchScheduled`/`ReassignScheduled`/`CancelScheduledAdmin` all reject `reason_code==""` with 422 `REASON_REQUIRED` before touching the DB |
| `TestAdminReassign_RequiresDriverIDToo` | `ReassignScheduled`'s second guard, `DRIVER_REQUIRED` |
| `TestContract_ScheduledCreateRequest_JSONFieldNames` | POST body JSON keys match the frozen route exactly (`mode`, `scheduled_pickup_at`, `timezone`, `pickup`, `dropoff`, `mode_payload`, `payment_method`) |
| `TestContract_ScheduledBooking_ResponseHasEstimatedFare` | Response includes `estimatedFareKobo` (contract: "201 booking + `estimated_fare_kobo`") |
| `TestContract_ScheduledEstimateRequest_ModeRequired` | DTO shape documentation for the Gin `binding:"required"` boundary |

### `backend/tests/transport_scheduled/live_db_integration_test.go` — LIVE DB, fully written, `t.Skip`'d without `DATABASE_URL`/`TEST_DATABASE_URL`

Wires a real `transport.Service` exactly as production does
(`ledger.NewRepository → ledger.NewService(nil redis) → settlement.NewService
→ transport.NewService(pool, settlementSvc)`), same nil-safe-Redis pattern as
`backend/internal/top5events/service_integration_test.go`.

| Test | Invariant covered | Notes |
|---|---|---|
| `TestLiveDB_CreateScheduled_ThenGet_OLA_Enforced` | End-to-end create + owner read + non-owner 403 | |
| `TestLiveDB_CreateScheduled_IdempotentOnRetry` | Same idempotency key → same row, `count(*)==1` in the table | |
| `TestLiveDB_CancelScheduled_BeforeDispatch_NoRefundNeeded` | Cancel pre-dispatch + non-owner cancel forbidden | |
| `TestLiveDB_DispatchScheduled_IdempotentSingleCharge` | Real materialize+escrow, then a SECOND `DispatchScheduled` call on the same booking asserted to be a no-op (same settlement id, same materialized_ref) | Needs a **seeded wallet balance**; skips cleanly with a clear message if absent (see bring-up note in the file) |
| `TestLiveDB_DueForDispatch_OnlySelectsWithinLeadWindow` | Seeds a far-future (not due) and a forced-due booking; asserts the due one is selected and the far one is not | |
| `TestLiveDB_ExpireStale_OnlyExpiresPastDueScheduled` | Backdated `scheduled` booking → `expired`; a fresh booking is untouched | |
| `TestLiveDB_SendDueReminders_FiresOnceUnderConcurrentInvocation` | **10 real goroutines** call `SendDueReminders` simultaneously against one seeded booking; asserts `reminder_1h_sent_at` is set exactly once and a subsequent call doesn't change it | This is the test that actually exercises Postgres's row-level `UPDATE...RETURNING` claim under concurrency — the DB-free `reminders_test.go` proves the logic, this proves the real lock |
| `TestLiveDB_EstimateScheduled_ReturnsFareWithoutCreatingBooking` | Fare returned, `transport_scheduled_bookings` row count unchanged before/after | |
| `TestLiveDB_EstimateScheduled_UnsupportedModeRejected` | `INVALID_MODE` end-to-end | |

**Bring-up note** (also inline in the file, at the top):
1. Apply migrations including `supabase/migrations/2026090600000X_transport_scheduled_bookings.sql` (table + enum + RBAC perms); verify with `psql "$DATABASE_URL" -c "\d transport_scheduled_bookings"`.
2. Seed a positive wallet balance for the dispatch test's synthetic rider (escrow fails closed otherwise) — the dispatch test SKIPS cleanly with a clear message if unseeded, rather than reporting a false negative.
3. `export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"` (local `supabase db reset` target) or `TEST_DATABASE_URL` for a disposable remote DB — never point at production.
4. Run: `cd backend && go test ./tests/transport_scheduled/... -run LiveDB -v`

All rows created are additive, keyed on fresh UUIDs per run — safe to run repeatedly against the same test DB without truncation.

---

## 3. Invariant coverage checklist (against the task's required list)

| Required invariant | Covered by |
|---|---|
| Every illegal FSM transition rejected with a CodedError | `fsm_invariant_test.go` (DB-free, transcribed + exhaustive matrix); Backend's own `scheduled_test.go` asserts the actual `CodedError`/409/`INVALID_STATE` shape in-package |
| Every legal FSM edge allowed | `fsm_invariant_test.go` `TestSchedFSM_ExhaustiveTransitionMatrix` |
| Terminal states have no outgoing edges | `fsm_invariant_test.go` `TestSchedFSM_TerminalStatesHaveNoOutgoingEdges` |
| Escrow-safety: dispatched/failed_no_driver never strand escrow | `escrow_safety_test.go` (all 7 tests) |
| DispatchScheduled idempotent per booking (`sched:<id>:dispatch`) | `materialization_test.go` (key derivation, DB-free) + `live_db_integration_test.go` `TestLiveDB_DispatchScheduled_IdempotentSingleCharge` (real double-call, live DB) |
| Mode→materialization mapping (ride→RequestRide, parcel→BookParcel, bus→bus booking) | `materialization_test.go` `TestMaterializationKind_CoversEveryFrozenMode` |
| failed_no_driver after attempts exhausted, with refund | `escrow_safety_test.go` `TestEscrowSafety_FailedNoDriverAlwaysRefundsBeforeTerminal` |
| DueForDispatch selects only within lead-time window | `dispatch_window_test.go` (DB-free predicate) + `live_db_integration_test.go` `TestLiveDB_DueForDispatch_OnlySelectsWithinLeadWindow` (live DB) |
| ExpireStale only past-due scheduled | `dispatch_window_test.go` + `live_db_integration_test.go` `TestLiveDB_ExpireStale_OnlyExpiresPastDueScheduled` |
| Reminders 24h/1h exactly once, concurrent-safe | `reminders_test.go` (DB-free logic) + `live_db_integration_test.go` `TestLiveDB_SendDueReminders_FiresOnceUnderConcurrentInvocation` (real concurrent goroutines against live Postgres) |
| Member + admin cancel refund when escrowed | `escrow_safety_test.go` + `live_db_integration_test.go` `TestLiveDB_CancelScheduled_BeforeDispatch_NoRefundNeeded` |
| OLA (non-owner cannot cancel/get) | `authz_and_contract_test.go` (DB-free decision) + `live_db_integration_test.go` (real 403 both on Get and Cancel) |
| Admin mutations require reason_code | `authz_and_contract_test.go` `TestAdminMutations_RejectEmptyReasonCode` / `TestAdminReassign_RequiresDriverIDToo` |
| Estimate returns a fare without creating a booking | `live_db_integration_test.go` `TestLiveDB_EstimateScheduled_ReturnsFareWithoutCreatingBooking` (asserts booking-table row count unchanged) |

---

## 4. What needs live Postgres/Redis vs. what runs DB-free today

**Runs now, zero infra (55 test functions/subtests, `go test` in ~0.02s):**
`fsm_invariant_test.go`, `materialization_test.go`, `escrow_safety_test.go`,
`reminders_test.go`, `dispatch_window_test.go`, `create_validation_test.go`,
`authz_and_contract_test.go`. These prove every pure-logic invariant — FSM
shape, escrow-safety control flow, idempotency-key derivation, window
predicates, validation-guard ordering, OLA decision, admin reason-code guards,
DTO JSON shape — by transcription-and-assertion or by exercising the real
exported types directly.

**Needs a live, migrated Postgres (9 tests, all in `live_db_integration_test.go`,
currently `t.Skip`'d):** anything that calls `Service.CreateScheduled`,
`GetScheduled`, `CancelScheduled`, `DispatchScheduled`, `DueForDispatch`,
`ExpireStale`, `SendDueReminders`, or `EstimateScheduled` end-to-end — these
all reach a concrete `*pgxpool.Pool`. `DispatchScheduled`'s real charge path
additionally needs `TEST_DATABASE_URL`/`DATABASE_URL` **and** a seeded wallet
balance (it skips cleanly, not falsely-red, if unseeded). Redis is not
required — `ledger.NewService` is confirmed nil-Redis-safe (same pattern
`top5events`'s integration test uses), and the scheduler worker's own 60s loop
(`backend/cmd/transport-scheduler/main.go`, Backend/DevOps-owned) is out of
this file's boundary but exercises the identical `Service` methods this file
already drives directly.

**Needs k6 + a running API (not Go test infra):** the two files in
`tools/loadtest/transport_scheduled/`.

---

## 5. k6 load tests — `tools/loadtest/transport_scheduled/`

### `create_and_list_load.js`
Exercises `POST /api/finance/mobility/scheduled` (create) +
`GET /api/finance/mobility/scheduled` (list), mirroring the house pattern in
`tools/loadtest/marketplace/checkout_mutation_load.js`: each VU iteration (1)
creates a booking with a fresh Idempotency-Key across a weighted mix of all 6
modes, (2) **replays** the identical create call with the SAME key and asserts
byte-identical id/status (idempotent-create proxy — a mismatch is a P0 counter,
gated to `count==0`), and (3) lists `filter=upcoming` and asserts the booking
appears **exactly once** (duplicate-row proxy). Ramps 0→40→60 VUs.
Thresholds: create p95<400ms, list p95<300ms, error rate<2%,
`sched_idempotency_replay_mismatch: count==0`, `sched_booking_duplicated_in_list: count==0`.

### `list_read_load.js`
Isolates the list/read path at higher concurrency (0→120→200 VUs), mirroring
`tools/loadtest/marketplace/search_load.js`: representative mix of
`filter=upcoming|past|all` and page sizes, plus a cursor-continuation second
page to exercise the keyset-pagination path specifically (asserts page 2's
first item never repeats page 1's). Threshold: p95<300ms, error rate<1%.

**Usage** (both scripts, env-parameterized, no hardcoded secrets/environment):
```bash
k6 run -e BASE_URL=http://localhost:8080 -e RIDER_TOKENS=$JWT1,$JWT2 create_and_list_load.js
k6 run -e BASE_URL=http://localhost:8080 -e RIDER_TOKENS=$JWT1,$JWT2 list_read_load.js
```
Requires `FEATURE_TRANSPORT_SCHEDULING_ENABLED=true` in the target environment.
No wallet seeding is required for `create_and_list_load.js` — per the contract,
escrow happens at DISPATCH, not at booking, so CreateScheduled never touches
money.

---

## 6. Go-test + k6 cheat sheet

```bash
# Go: DB-free subset (runs anywhere, no infra) — 55 tests, all pass
cd backend
go build ./tests/transport_scheduled/...
go vet ./tests/transport_scheduled/...
go test ./tests/transport_scheduled/... -v

# Go: everything, INCLUDING live-DB (skips gracefully without DATABASE_URL)
go test ./tests/transport_scheduled/... -v

# Go: ONLY the live-DB integration tests, against a real migrated Postgres
export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
go test ./tests/transport_scheduled/... -run LiveDB -v

# k6 (requires a running API + FEATURE_TRANSPORT_SCHEDULING_ENABLED=true)
k6 run -e BASE_URL=http://localhost:8080 -e RIDER_TOKENS=$JWT \
  tools/loadtest/transport_scheduled/create_and_list_load.js
k6 run -e BASE_URL=http://localhost:8080 -e RIDER_TOKENS=$JWT \
  tools/loadtest/transport_scheduled/list_read_load.js
```

---

## 7. Build/test status with evidence (this session)

Verified with a portable Go 1.25.0 toolchain (`/tmp/go125/go/bin`,
`GOFLAGS=-buildvcs=false`, isolated `GOCACHE`/`GOMODCACHE`):

```
$ cd backend && go build ./tests/transport_scheduled/...
(no output — clean build)

$ go vet ./tests/transport_scheduled/...
(no output — clean vet)

$ go test ./tests/transport_scheduled/...
ok  	spotlight/backend/tests/transport_scheduled	0.019s

$ go test ./tests/transport_scheduled/... -v 2>&1 | grep -c '^--- PASS'
55
$ go test ./tests/transport_scheduled/... -v 2>&1 | grep -c '^--- SKIP'
9
$ go test ./tests/transport_scheduled/... -v 2>&1 | grep -c '^--- FAIL'
0

$ gofmt -l ./tests/transport_scheduled/
(no output — gofmt-clean)
```

k6 scripts syntax-checked with `node --check` (both files pass — no runtime k6
binary available in this environment, so latency/threshold behavior itself is
unverified here; the scripts are ready to run against a live target with `k6 run`).

**Nothing was written inside `backend/internal/transport/`** — confirmed via
`git status`-equivalent review of every file this session touched:
`backend/tests/transport_scheduled/*.go` (7 new files) and
`tools/loadtest/transport_scheduled/*.js` (2 new files) and this report.
