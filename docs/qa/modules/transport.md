# Module: Transport & Mobility

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flags:** `FEATURE_TRANSPORT_ENABLED` (ride-hailing core, default OFF) · `FEATURE_TRANSPORT_MODES_ENABLED` (parcel/bus/towing/movers/car-hire/logistics/event) · `FEATURE_TRANSPORT_SCHEDULING_ENABLED` (future-dated dispatch)
**Code:** `backend/internal/transport/` — ride-hailing: `mobility_service.go`, `dispatch.go`, `service.go`, `pricing.go`, `negotiation.go`, `model.go`, `safety.go`, `ratings.go`, `mode_ratings.go`, `reconciler.go`; modes: `parcel.go`, `bus.go`/`bus_provider.go`/`bus_templates.go`, `towing.go`, `movers.go`, `car_hire.go`, `event_transport.go`, `logistics.go`, `modes_common.go`; scheduled: `scheduled.go`, `scheduled_dispatch.go`, `scheduled_fsm.go`, `scheduled_admin.go`; handlers `*_handler.go`, `customer_handler.go`, `driver_handler.go`, `admin.go`/`admin_*.go`, `onboarding.go`, `presign.go`. Tests cited in §3. Mounting: `backend/internal/app/finance_routes.go` (lines ~1493–1865) + worker `cmd/transport-scheduler/main.go`. External: `backend/tests/transport_scheduled/*.go`.
**Slug:** `TRANSPORT`

## 1. Overview & scope

Ride-hailing plus a family of logistics modes on a shared settlement/escrow + driver-gate + pricing + audit spine. The **ride-hailing** core: a rider requests a trip; the system fare is computed from a routed distance/duration; the fare (instant) or the rider's in-range offer is **escrowed** after a **fail-closed KYC-tier/daily-limit gate**; a hybrid negotiation (`fare_offers`) may adjust the held amount via stable-keyed delta escrows; an **approved** driver accepts (single-winner compare-and-set) subject to a driver-profit floor; the ride walks a fine-grained `trips.phase` FSM to `completed`, where `settleTrip` releases escrow with the driver's commission-tier split (provider/platform; tips 100% provider). Cancellation refunds all escrow. A crash-recovery reconciler re-drives stranded escrow, and a durable `settlement_pending` marker is written if settlement fails after completion.

**Modes** (`FEATURE_TRANSPORT_MODES_ENABLED`) reuse the same escrow/driver-gate/audit: parcel (escrow at book, release on dropoff PIN + proof), bus + interstate bus-provider marketplace, towing, movers (bid → accept → complete), car-hire, business logistics, event transport. **Scheduled** (`FEATURE_TRANSPORT_SCHEDULING_ENABLED`) is a scheduling layer over those modes with its own FROZEN FSM — no money at create, escrow at dispatch, refund-before-terminal on failure, owner-scoped (OLA).

**⚠️ Go-live guard:** in production the module refuses to boot if no `MapService` is wired (`log.Fatalf`) — `MockMaps` fabricates fares from haversine and would let riders escrow amounts derived from invented distances.

Member routes: `/api/finance/{transport,mobility,driver}` (auth `RequireAuthContext` + `requireUserID`). Admin: `/api/finance/admin/transport` (`mapsAuth` + `requireUserID` + `RequireAdmin(AdminAPIKey)` + per-route `RequirePermission(mobility.*)`). Public share resolve: `/api/finance/mobility/public/track/:token` (non-sensitive, TTL-bounded, never the PIN).

Cross-cutting: `../cross-cutting/money-invariants.md`, `../cross-cutting/kyc-and-tiers.md` (the `enforceTierLimit` gate delegates to the shared tiers service — `KYC-*`), `../cross-cutting/rbac-and-permissions.md` (`mobility.view`/`.manage` slugs), `../cross-cutting/authentication.md`, `../cross-cutting/webhooks-and-providers.md` (MapService bridge), `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Representative endpoints (customer + driver + admin + scheduled + one settlement path per mode). Full list in `finance_routes.go`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Fare estimate | `POST /api/finance/mobility/rides/estimate` | member | no |
| **Request ride (escrow)** | `POST /api/finance/mobility/rides/request` | member (rider); tier gate | **yes** |
| Rider re-offer / accept counter | `POST /mobility/rides/:id/{offer,accept-counter}` | trip rider; tier gate on delta | **yes** (delta escrow) |
| Cancel ride (refund) | `POST /mobility/rides/:id/cancel` | trip rider (FSM) | **yes** |
| Get / active ride | `GET /mobility/rides/:id`, `GET /mobility/rides/active` | rider or assigned driver (OLA) | no |
| Share ride / SOS / rate | `POST /mobility/rides/:id/{share,sos,rate}` | trip rider | rate: tip escrow (all-provider) |
| Public share resolve | `GET /api/finance/mobility/public/track/:token` | none (token TTL) | no |
| Driver requests feed | `GET /api/finance/driver/requests` | approved driver | no |
| **Driver accept (single-winner)** | `POST /driver/requests/:id/accept` | approved driver; profit floor | **yes** (locks fare) |
| Driver counter | `POST /driver/requests/:id/counter` | approved driver | no |
| Driver arrive / verify-PIN / start | `POST /driver/trips/:id/{arrive,verify-pin,start}` | assigned driver (FSM + PIN) | no |
| **Driver complete (settle)** | `POST /driver/trips/:id/complete` | assigned driver | **yes** (settleTrip) |
| Driver earnings | `GET /driver/earnings` | approved driver | no |
| Driver register / status / docs / vehicle | `POST /transport/drivers`, `PATCH /driver/status`, `POST /driver/{documents,documents/presign,vehicle}` | self (user_id) | no |
| **Parcel book / verify-dropoff** | `POST /mobility/parcels`, `POST /driver/parcels/:id/verify-dropoff` | sender / assigned courier; tier gate | **yes** (escrow / settle) |
| **Bus book** | `POST /mobility/bus/book` | member; tier gate | **yes** (escrow; settle to operator) |
| **Towing / movers / car-hire book** | `POST /mobility/{towing,movers/quote→,car-hire/book}` | member; tier gate | **yes** |
| **Create scheduled booking** | `POST /mobility/scheduled` | member (owner); Idem-Key; NO money at create | **yes** (escrow at dispatch) |
| Cancel scheduled | `POST /mobility/scheduled/:id/cancel` | owner (OLA); Idem-Key | **yes** (refund if escrowed) |
| Get/list scheduled | `GET /mobility/scheduled[/:id]` | owner (OLA) | no |
| Admin dashboard / drivers / trips / dispatch | `GET /admin/transport/{dashboard,drivers,trips,dispatch/live}` | `mobility.view` | no |
| Admin verify driver / assign / pricing / commission | `PATCH .../drivers/:id/verification`, `POST .../dispatch/:trip_id/assign`, `PATCH .../pricing`, `.../commission/:tier` | `mobility.ride.manage` / `mobility.manage` | pricing/commission affect splits |
| Admin scheduled ops board | `GET/POST /admin/transport/scheduled...` | `sched.read` / `sched.reassign` / `sched.cancel` | force-dispatch escrows |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Ride-hailing phase FSM (legal, illegal, self, cancel windows, safety-hold) | fsm/unit | `internal/transport/mobility_engine_test.go` (`TestCanTransition_*`), `money_authz_test.go` (`TestPhaseGuard_*`) | AUTOMATED |
| System-fare composition / min floor / surge; offer bounds; fare-range; profit floor | unit | `internal/transport/mobility_engine_test.go` (`TestSystemFare_*`, `TestOfferBounds`, `TestValidateFareInRange`, `TestEnforceDriverProfitFloor`, `TestProfitFloor_LowerCommissionAllowsLowerFare`) | AUTOMATED |
| Settlement split builders sum to 1.0 (tiered provider/platform + all-provider tip) | inv | `internal/transport/split_invariant_test.go`, `mobility_engine_test.go` (`TestCommissionSplitsSumToWhole`) | AUTOMATED |
| Delta-escrow idempotency key stable per (trip,fare), distinct across fares/trips | inv | `internal/transport/money_authz_test.go` (`TestDeltaEscrowKey_*`) | AUTOMATED |
| Tier gate fail-closed (under/over limit, dep error, nil gate, zero-amount noop) | inv/sec | `internal/transport/money_authz_test.go` (`TestEnforceTierLimit_*`) | AUTOMATED |
| Trip object-level authz (rider/assigned-driver, cross-user rejected) | authz | `internal/transport/money_authz_test.go` (`TestTripActorAllowed_*`) | AUTOMATED |
| `settlement_pending` marker carries id+cause; status is pending not settled | inv | `internal/transport/money_authz_test.go` (`TestSettlementPendingMarker_*`, `TestSettlementPendingStatus_*`) | AUTOMATED |
| Mode fares + mode phase guards (parcel/towing/car-hire/mover/delivery) | unit/fsm | `internal/transport/modes_engine_test.go` (`TestParcel*`, `TestTowing*`, `TestCarHire*`, `TestMover*`, `TestDelivery*`) | AUTOMATED |
| Bus-provider ownership / seat math / slug / same-state guard | unit/authz | `internal/transport/bus_provider_test.go` | AUTOMATED |
| Reconciler grace-window literal + stuck-trip predicate guards | unit | `internal/transport/reconciler_test.go` (`TestFormatInterval`, `TestStuckTripSelect_Predicate`) | AUTOMATED |
| Scheduled FSM (legal/illegal/terminal, exhaustive matrix, every mode same FSM) | fsm | `internal/transport/scheduled_test.go`, `backend/tests/transport_scheduled/fsm_invariant_test.go` | AUTOMATED |
| Scheduled create validation (idem-key, mode, RFC3339, past pickup, lead-time, guard order) | con | `backend/tests/transport_scheduled/create_validation_test.go` | AUTOMATED |
| Scheduled OLA + admin mutation contract (reason codes, driver id) | authz/con | `backend/tests/transport_scheduled/authz_and_contract_test.go` | AUTOMATED |
| Scheduled live-DB: idempotent single-charge dispatch, cancel refund, due-window, expiry, reminders | int | `backend/tests/transport_scheduled/live_db_integration_test.go` (gated `TEST_DATABASE_URL`) | AUTOMATED |
| Scheduled escrow safety (refund-before-terminal, cancel idempotent, expire never escrowed) | inv | `backend/tests/transport_scheduled/escrow_safety_test.go` | AUTOMATED |
| Dispatch/expire windows + materialization kind + dispatch idem key | unit/int | `backend/tests/transport_scheduled/{dispatch_window,materialization,reminders}_test.go` | AUTOMATED |
| RequestRide → escrow → complete → settle (handler→service→DB) | int/e2e | — | TODO |
| DriverAccept single-winner concurrency (live DB) | int | — | TODO |
| Ride reconciler re-drive idempotency (live DB) | inv | — | TODO |
| Admin RBAC matrix for `/admin/transport/*` | authz | partial via `../cross-cutting/rbac-and-permissions.md` | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `TRANSPORT-E2E-001` | Instant ride happy path settles at commission split | P0 | Flags ON; funded rider (KYC passes); approved online driver; pricing config seeded | Estimate; request (instant); driver accept; arrive; verify-PIN; start; complete | system fare **200 000** kobo, standard tier 80/20 | Trip `completed`; escrow settled → driver-wallet **160 000**, platform **40 000** = 200 000, kobo-exact; no negative leg |
| `TRANSPORT-CON-001` | Request requires Idempotency-Key | P0 | Flag ON | `POST /mobility/rides/request` with no key | — | 400 `MISSING_IDEMPOTENCY_KEY`; no escrow |
| `TRANSPORT-INT-001` | Offer-mode fare must be within [floor,ceiling] | P0 | Pricing floor 0.8 / ceiling 1.5; system fare 200 000 | Request offer 100 000 (below), then 350 000 (above), then 180 000 | — | Below → 422 `FARE_BELOW_FLOOR`; above → 422 `FARE_ABOVE_CEILING`; in-range → escrows 180 000, phase `fare_negotiating` |
| `TRANSPORT-INV-001` | Delta escrow keyed on target fare — no double charge on retry | P0 | Trip in `fare_negotiating`, held 180 000 | Raise offer to 220 000; retry the SAME raise | delta 40 000 | Exactly one 40 000 delta escrow (`trip:<id>:delta:220000`); retry no-ops at ledger (`ErrDuplicate`); total held 220 000 |
| `TRANSPORT-SEC-001` | Tier gate blocks over-limit / KYC-incomplete rider before escrow | P0 | Rider over daily wallet-debit limit (or Tier-0) | Request ride | fare 200 000 | 403 `FORBIDDEN` from `enforceTierLimit`; NO escrow, NO trip row. See `../cross-cutting/kyc-and-tiers.md` (`KYC-*`) |
| `TRANSPORT-AUTHZ-001` | Only registered + approved driver may accept | P0 | Caller not a driver / driver `under_review` | `POST /driver/requests/:id/accept` | — | 403 `FORBIDDEN` (not a driver) / `DRIVER_NOT_APPROVED` |
| `TRANSPORT-INT-002` | DriverAccept single-winner under concurrency | P0 | Trip open, two approved drivers | Two `POST /accept` simultaneously | fare in range | Compare-and-set (`driver_id IS NULL`): one wins (`driver_assigned`, driver `on_trip`); the other → 409 `INVALID_STATE` "already accepted by another driver" |
| `TRANSPORT-SEC-002` | Accepted fare must keep driver above profit floor | P0 | Profit floor 150 000; tier 80/20 | Driver accepts a fare whose 80% < 150 000 | fare 180 000 → net 144 000 | 422 `FARE_BELOW_FLOOR` (profit-floor); no assignment, escrow untouched |
| `TRANSPORT-SEC-003` | PIN gate before ride start | P0 | Trip `driver_arriving`, PIN `4271` | `verify-pin` with `0000`, then `4271` | — | Wrong → 422 `PIN_MISMATCH`, stays `driver_arriving`; correct → `pin_verified` |
| `TRANSPORT-AUTHZ-002` | Trip read/mutate scoped to rider or assigned driver (IDOR) | P0 | Trip owned by rider R1/driver D1; caller X | `GET /mobility/rides/:id` and driver transitions as X | — | 403 `FORBIDDEN`; PIN never exposed to non-rider (`TripDetail` hides it in driver view) |
| `TRANSPORT-INT-003` | Cancel refunds all escrow (base + deltas) | P0 | Trip `fare_negotiating` with base + delta escrow | `POST /mobility/rides/:id/cancel` | held 220 000 | All escrowed settlements for `trip:<id>%` refunded to rider; phase `cancelled`; driver (if any) freed |
| `TRANSPORT-INV-002` | Settlement conservation across tiers | P0 | Complete trips at tiers standard/low/fleet | Complete each | fare 200 000 | provider+platform = 200 000 exactly for 80/20, 88/12, 85/15; provider leg = remainder (absorbs rounding); no negative leg (`split_invariant_test.go`) |
| `TRANSPORT-INV-003` | Tip settles 100% to driver | P1 | Delivered trip; rate with tip | `POST /mobility/rides/:id/rate` with `tip_kobo` | tip 50 000 | Tip escrow settled all-provider (platform 0); driver credited 50 000 |
| `TRANSPORT-INV-004` | Completion-then-settle-failure is not swallowed | P0 | Force `settleTrip` error after completion commit | Complete trip; simulate settle failure | — | Trip stays `completed`; `settlement_status='settlement_pending'` + immutable `trip_events` marker carrying settlement id + cause; caller gets clear error |
| `TRANSPORT-INV-005` | Reconciler re-drives stranded escrow idempotently | P0 | `phase='completed'` + `settlements.status='escrowed'` past grace | Run `ReconcileStuckSettlements` twice | grace 600 s | 1st settles once + flips flag to `settled`; 2nd no-ops (Settle guards `escrowed`, legs `ON CONFLICT DO NOTHING`); balances unchanged after 2nd |
| `TRANSPORT-E2E-002` | Parcel: book escrow → dropoff PIN + proof settles courier | P0 | Modes flag ON; funded sender; approved courier | Book parcel; courier accept, verify pickup PIN, picked-up, verify dropoff | fare 120 000, standard 80/20 | Escrow at book (tier-gated); settle only after dropoff verified → courier 96 000 + platform 24 000 = 120 000 |
| `TRANSPORT-INT-004` | Bus booking escrows then settles operator | P1 | Modes flag ON; seat available | `POST /mobility/bus/book`; complete/validate | fare 300 000 | Escrow at book; settle to operator with commission split; seat decremented, no oversell (`bus_provider_test.go` seat math) |
| `TRANSPORT-FSM-SCHED-E2E` | Scheduled: create (no money) → dispatch escrows once → complete | P0 | Scheduling flag ON; worker running; funded owner | Create scheduled ride (Idem-Key); let worker dispatch at lead window | fare 200 000 | Create takes NO money; dispatch escrows once (`sched:<id>:dispatch`), status `dispatched`; underlying trip completes → `completed` |
| `TRANSPORT-SEC-004` | Scheduled OLA — non-owner cannot read/cancel | P0 | Booking owned by U1; caller U2 | `GET /mobility/scheduled/:id`, cancel as U2 | — | Not found / forbidden (owner-scoped query `user_id=$1`); empty caller never matches (`authz_and_contract_test.go`) |
| `TRANSPORT-INV-006` | Scheduled dispatch failure refunds before terminal | P0 | Dispatch materialization fails (no driver) | Trigger dispatch; exhaust attempts | escrow taken | Escrow refunded, then FSM → `failed_no_driver` (refund-before-terminal, `escrow_safety_test.go`); never strands funds |
| `TRANSPORT-CON-002` | Scheduled create validation | P1 | Scheduling flag ON | Create with: no Idem-Key; bad mode; non-RFC3339 time; past pickup; negative lead-time | — | Each rejected with the matching 400/422; guard order preserved (`create_validation_test.go`) |
| `TRANSPORT-AUTHZ-003` | Admin transport routes fail-closed on RBAC | P0 | Caller lacking `mobility.*` slug | Hit `GET /admin/transport/dashboard`, `PATCH .../pricing`, `POST .../dispatch/:id/assign` | — | 403 from `RequirePermission`; reads need `mobility.view`, mutations `.manage`. See `../cross-cutting/rbac-and-permissions.md` |
| `TRANSPORT-SEC-005` | Public share link leaks no PIN/PII | P1 | Active shared trip, valid + expired token | `GET /mobility/public/track/:token` | — | Valid → non-sensitive tracking only (never trip PIN); expired/invalid → rejected (TTL enforced) |
| `TRANSPORT-SEC-006` | Prod boot blocked without MapService | P0 | `APP_ENV=production`, `FEATURE_TRANSPORT_ENABLED=true`, no MapService | Boot | — | `log.Fatalf` — refuses to boot with fare-fabricating `MockMaps`; non-prod logs a loud warning instead |
| `TRANSPORT-SEC-00x` | Flags OFF hide surfaces | P0 | `FEATURE_TRANSPORT_ENABLED=false` (and modes/scheduling off) | Call `/mobility/*`, `/driver/*`, `/mobility/parcels`, `/mobility/scheduled` | — | 404 (routes not registered); modes/scheduled independently gated; reconciler not started. Reference `../cross-cutting/feature-flags-and-audit.md` (`FLAG-SEC-001`) |

## 5. State-machine transitions

### 5a. Ride-hailing phase FSM (`allowedTransitions` in `model.go`; `canTransition`)

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `requested` | rider/driver offer | `fare_negotiating` | open/extend `fare_offers`; delta escrow | `TRANSPORT-FSM-001` |
| `requested`/`fare_negotiating` | driver accept | `driver_assigned` | single-winner CAS; lock `final_fare_kobo`; driver `on_trip` | `TRANSPORT-FSM-002` |
| `driver_assigned` | driver arrive | `driver_arriving` | audit event | `TRANSPORT-FSM-003` |
| `driver_arriving` | verify PIN | `pin_verified` | PIN must match | `TRANSPORT-FSM-004` |
| `pin_verified` | start | `in_progress` | `started_at` set | `TRANSPORT-FSM-005` |
| `in_progress` | complete | `completed` | **settleTrip** commission split | `TRANSPORT-FSM-006` |
| requested/negotiating/assigned/arriving/pin_verified/in_progress | safety-hold | `safety_hold` | freeze; can resume to in_progress/completed or cancel | `TRANSPORT-FSM-007` |
| requested/negotiating/assigned/arriving/pin_verified | cancel | `cancelled` | **refund** all escrow | `TRANSPORT-FSM-008` |

Illegal (rejected 409 `INVALID_STATE`), asserted in `TRANSPORT-FSM-009`: any skip (e.g. `requested→in_progress`, `driver_assigned→completed`), cancel after `in_progress`/from terminal, self-transitions (`from==to` always false), completing from anything but `in_progress`/`safety_hold`. Terminals `completed`/`cancelled`/`no_show` have no outgoing edges; a second `completed` is blocked by both the FSM guard and `settlement.Settle`'s `escrowed`-only guard (idempotent terminal re-entry).

### 5b. Scheduled-booking FROZEN FSM (`scheduled_fsm.go`; `guardScheduled`)

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `scheduled` | scheduler: due (pickup − lead ≤ now) | `dispatch_pending` | none | `TRANSPORT-FSM-010` |
| `dispatch_pending` | materialize + escrow OK | `dispatched` | escrow taken (`sched:<id>:dispatch`) | `TRANSPORT-FSM-011` |
| `dispatch_pending` | no driver / mode error, attempts exhausted | `failed_no_driver` | **refund escrow first** | `TRANSPORT-FSM-012` |
| `dispatched` | underlying trip/parcel/bus completes | `completed` | — | `TRANSPORT-FSM-013` |
| `scheduled`/`dispatch_pending` | user/admin cancel | `cancelled` | refund escrow if taken | `TRANSPORT-FSM-014` |
| `scheduled` | pickup passed, never dispatched (safety net) | `expired` | none (never escrowed) | `TRANSPORT-FSM-015` |

Illegal + self transitions rejected 409 (`fsm_invariant_test.go` exhaustive matrix). Terminals `completed`/`cancelled`/`failed_no_driver`/`expired` have no outgoing edges; cancel is idempotent (`escrow_safety_test.go`).

## 6. Security & abuse cases

- **Fail-closed KYC/tier gate:** `enforceTierLimit` runs before every rider-funded escrow (request, delta, tip, mode book); denies over-limit/KYC-incomplete, denies on dependency error, denies on nil gate, zero-amount is a no-op — `TRANSPORT-SEC-001`, `money_authz_test.go`. Cross-ref `KYC-*`.
- **Server-side fare authority:** system fare from the routed distance; offers clamped to admin floor/ceiling; accepted fares re-validated against the driver-profit floor (`TRANSPORT-INT-001`, `TRANSPORT-SEC-002`). Prod refuses fare-fabricating `MockMaps` (`TRANSPORT-SEC-006`).
- **Idempotency / no double-charge:** `MISSING_IDEMPOTENCY_KEY` on request/scheduled create+cancel; delta escrow keyed on the absolute target fare (stable across retries) — `TRANSPORT-CON-001`, `TRANSPORT-INV-001`; scheduled dispatch keyed `sched:<id>:dispatch` (`live_db_integration_test.go` single-charge). See `../cross-cutting/money-invariants.md`.
- **Authz / IDOR:** trip actions restricted to rider or assigned driver; driver-gate on accept/complete; scheduled OLA to owner; public share link exposes no PIN/PII — `TRANSPORT-AUTHZ-001/002/003`, `TRANSPORT-SEC-004/005`.
- **Single-winner concurrency:** `driver_id IS NULL` CAS on accept — `TRANSPORT-INT-002`.
- **Settlement conservation & durability:** integer kobo, split validated to 1.0 fail-closed; provider leg = remainder (absorbs rounding, non-negative); completion-then-failure records `settlement_pending` + reconciler re-drive — `TRANSPORT-INV-002/004/005`.
- **Admin mutations audited:** pricing/commission/verification/assign/scheduled-ops write immutable audit rows; reference `../cross-cutting/feature-flags-and-audit.md` (`AUDIT-*`).
- **Flag-off:** `TRANSPORT-SEC-00x`.

## 7. Automated specs to add

- `internal/transport/request_ride_test.go` — handler→service (hoisted mocks over `maps`, `settlement`, `tiers`): escrow = system fare (instant) / in-range offer; tier gate called BEFORE escrow; Idem-Key precedence. **(covers `TRANSPORT-CON-001`, `TRANSPORT-SEC-001`)** TODO.
- `internal/transport/driver_accept_concurrency_test.go` — live-DB (gated `TEST_DATABASE_URL`) two-driver race; assert single winner + 409 for loser. **(covers `TRANSPORT-INT-002`)** TODO.
- `internal/transport/settle_trip_test.go` — split assertion per commission tier + tip-all-provider against a fake settlement; kobo-exact conservation. **(covers `TRANSPORT-INV-002/003`)** TODO.
- `internal/transport/reconciler_live_db_test.go` — seed completed+escrowed trip, reconcile twice, assert settle-once + no balance drift. **(covers `TRANSPORT-INV-005`)** TODO.
- `backend/tests/transport_scheduled/dispatch_refund_test.go` — extend suite: dispatch-failure refund-before-terminal against live DB for each mode. **(covers `TRANSPORT-INV-006`)** TODO.
- `internal/transport/parcel_settle_test.go` — assert no settle before dropoff-verified phase; settle only after (guards already unit-tested in `money_authz_test.go`). **(covers `TRANSPORT-E2E-002`)** TODO.
- Admin RBAC matrix spec for `/admin/transport/*` (view vs manage slugs). **(covers `TRANSPORT-AUTHZ-003`)** TODO.

## 8. Coverage target & exit criteria

Coverage floor: Tier-0 pure logic ≥ 85% — fare/offer/profit-floor math, both FSMs, split builders, delta-key, tier-gate decision, reconciler predicate, and the full scheduled suite are already automated. The live money seams (RequestRide escrow, DriverAccept CAS, settleTrip split, ride reconciler) must have committed integration tests before go-live.

Exit criteria (all must be green): `TRANSPORT-E2E-001/002`, `TRANSPORT-CON-001/002`, `TRANSPORT-SEC-001..006`, `TRANSPORT-INT-001..004`, `TRANSPORT-INV-001..006`, `TRANSPORT-AUTHZ-001..003`, both FSM matrices (`TRANSPORT-FSM-009`, `fsm_invariant_test.go`), and `TRANSPORT-SEC-00x`. Production enablement additionally requires the MapService go-live guard verified (`TRANSPORT-SEC-006`) and each mode/scheduling flag exercised independently.
