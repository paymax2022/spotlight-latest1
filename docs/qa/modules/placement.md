# Module: Placement (Featured Placement)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_PLACEMENT_ENABLED`
**Code:** `backend/internal/placement/` — `handler.go`, `service.go`, `model.go`, `repository.go`, `eligibility.go`, `resolver.go`, `scheduler.go`, `placement_test.go`. Mounted in `backend/internal/app/placement_routes.go` (`RegisterPlacement`, called from `finance_routes.go` under the flag): member on the finance group → `/api/finance/placement/*`; admin on `r.Group("/api/placement/admin")` with per-route RBAC `placement.admin.*`; PUBLIC (no auth) `/api/finance/placement/{landing,events}` on the root engine. Money reuses `finance/ledger` + `finance/wallet` + `finance/tiers` (standing accounts `PLACEMENT_ESCROW` / `PLACEMENT_REVENUE`).
**Slug:** `PLACEMENT` (uppercase, used in Case IDs)

## 1. Overview & scope

Featured Placement is a paid landing-page promotion: merchants book scarce ad inventory (zones) for a window, are reviewed, then have the price held in escrow, activated by a scheduler, recognised as revenue on completion, or refunded (full pre-start / pro-rata early-cancel). All money is **integer kobo** with half-up rounding; the money movement REUSES the finance ledger primitives — **HOLD** = `wallet.Debit` (tier-checked, fail-closed) → `PLACEMENT_ESCROW`; **REFUND** = `ledger.PostReversal` (escrow → merchant wallet); **RECOGNIZE** = `ledger.PostJournal` (escrow → `PLACEMENT_REVENUE`). Every money leg is idempotent on `placement:<id>:<op>` and every transition is guarded (optimistic-locked, no raw status writes) with an immutable `placement_audit_log` row. Testing priorities: the pricing/pro-rata integer math (already well covered), the guarded state machine, escrow HOLD/RECOGNIZE/REFUND conservation + idempotency, eligibility gates (cap/cooldown/creative + external merchant/subject), the serving resolver (deterministic rotation, capacity cap, house fallback), and object-level ownership. Cross-cutting: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `kyc-and-tiers.md`, `feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Create draft campaign | `POST /api/finance/placement/campaigns` `{subject_type, subject_id, zone_code, window_start, duration_days, creative}` | member (merchant = token) | no |
| List my campaigns | `GET /api/finance/placement/campaigns` | member (own) | no |
| Get campaign | `GET /api/finance/placement/campaigns/:id` | member; **owner** | no |
| Quote price | `POST /api/finance/placement/campaigns/:id/quote` | member; **owner** | no |
| Submit for review | `POST /api/finance/placement/campaigns/:id/submit` + `Idempotency-Key` | member; **owner** | no (eligibility gate) |
| Pay (PENDING_PAYMENT retry) | `POST /api/finance/placement/campaigns/:id/pay` + `Idempotency-Key` | member; **owner** | **yes** (escrow HOLD) |
| Cancel | `POST /api/finance/placement/campaigns/:id/cancel` | member; **owner** | **yes** (refund if held) |
| Pause | `POST /api/finance/placement/campaigns/:id/pause` | member; **owner** | no |
| Resume | `POST /api/finance/placement/campaigns/:id/resume` | member; **owner** | no |
| Analytics | `GET /api/finance/placement/campaigns/:id/analytics` | member; **owner** | no |
| List zones | `GET /api/finance/placement/zones` | member | no |
| Admin review queue | `GET /api/placement/admin/review-queue` `?state` | `RequirePermission("placement.admin.review")` | no |
| Admin get | `GET /api/placement/admin/campaigns/:id` | `placement.admin.review` | no |
| Admin approve | `POST /api/placement/admin/campaigns/:id/approve` | `placement.admin.approve` | **yes** (escrow HOLD) |
| Admin reject | `POST /api/placement/admin/campaigns/:id/reject` `{reason}` | `placement.admin.reject` | no |
| Admin request info | `POST /api/placement/admin/campaigns/:id/request-info` `{reason}` | `placement.admin.review` | no |
| Admin suspend | `POST /api/placement/admin/campaigns/:id/suspend` `{reason}` | `placement.admin.suspend` | **yes** (pro-rata) |
| Public landing resolver | `GET /api/finance/placement/landing` `?session_id` | **none (public)** | no |
| Public analytics ingest | `POST /api/finance/placement/events` `{events[]}` | **none (public)** | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| FSM legality (`canTransition` legal/illegal edges; terminal has no out-edges) | fsm | `internal/placement/placement_test.go` (`TestCanTransition`, `TestIsTerminal`) | AUTOMATED |
| Duration discount bps mapping (1/3/7/14/30d) | unit | `placement_test.go` (`TestDurationDiscountBps`) | AUTOMATED |
| Quote price integer kobo (tier mult thousandths, discount bps, half-up) | inv | `placement_test.go` (`TestQuotePriceKobo`, `TestHalfUpDiv`) | AUTOMATED |
| Pro-rata split earned+refund==quoted (no rounding leak) | inv | `placement_test.go` (`TestProRataSplit`, `TestElapsedDaysUTC`) | AUTOMATED |
| Resolver rotation deterministic by session; pooled cap; hero house fallback | unit | `placement_test.go` (`TestRotationDeterminismBySession`, `TestPooledCapacityCap`, `TestHeroFallbackNeverEmpty`) | AUTOMATED |
| Creative validation (image/headline/banned/cta + boundary) | unit | `placement_test.go` (`TestValidateCreative`) | AUTOMATED |
| Escrow HOLD/REFUND/RECOGNIZE money moves + idempotency keys | inv/int | — (money legs in `service.go`) | TODO |
| Eligibility cap/cooldown + external merchant/subject gate | int | — (`eligibility.go`; external is Permissive default) | TODO |
| Ownership on `:id` ops (`ownedCampaign` → `ErrForbidden`) | authz | — | TODO |
| Exclusive slot conflict (`ErrSlotTaken`) + optimistic lock (`ErrConflict`) | int | — | TODO |
| Scheduler activate/expire/reconcile sweeps | int | — (`scheduler.go`; not yet ticker-wired) | TODO |
| Flag-off route not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `PLACEMENT-INT-001` | Create → quote → submit → approve → scheduled | P0 | merchant funded; hero zone seeded | create draft → quote → submit → admin approve | zone base `5_000_000`/day, 1 day, mult 1.0 | quoted `5_000_000`; approve HOLDs escrow → `SCHEDULED`; exclusive reservation inserted |
| `PLACEMENT-INT-002` | Approve → HOLD debits escrow | P0 | campaign `UNDER_REVIEW`, wallet ≥ quote | `POST /admin/:id/approve` | quote `5_000_000` | merchant wallet −`5_000_000`; `PLACEMENT_ESCROW` +`5_000_000`; idem `placement:<id>:hold`; `escrow_hold` audit |
| `PLACEMENT-INT-003` | Insufficient funds at approve → PENDING_PAYMENT | P0 | wallet < quote | `POST /admin/:id/approve` | wallet `0` | → `PENDING_PAYMENT` (not SCHEDULED); no escrow held |
| `PLACEMENT-INT-004` | Pay retry from PENDING_PAYMENT | P1 | `PENDING_PAYMENT`, merchant topped up | `POST /:id/pay` + key | quote covered | HOLD succeeds → `SCHEDULED`; idempotent on hold key |
| `PLACEMENT-INT-005` | Scheduler activation SCHEDULED→ACTIVE | P1 | `SCHEDULED`, `window_start` reached | run `RunActivations` | eligible | → `ACTIVE`; reservation state ACTIVE; ineligible campaigns skipped (left SCHEDULED) |
| `PLACEMENT-INT-006` | Scheduler expiry recognises full revenue | P0 | `ACTIVE`, `window_end` passed | run `RunExpirations` | held `5_000_000` | `recognizeFull`: escrow → `PLACEMENT_REVENUE` `5_000_000`; → `COMPLETED`; idem `placement:<id>:recognize` |
| `PLACEMENT-INT-007` | Cancel before start → full refund | P0 | `SCHEDULED`, before `window_start` | `POST /:id/cancel` | held `5_000_000` | `refundFull` reversal escrow → merchant wallet `5_000_000`; → `CANCELLED`; idem `placement:<id>:refund` |
| `PLACEMENT-INT-008` | Early cancel → pro-rata split | P0 | `ACTIVE`, 4 of 10 days elapsed | `POST /:id/cancel` (routes to CancelEarly) | quoted `100_000`, elapsed 4/10 | earned `40_000` → revenue; refund `60_000` → wallet; earned+refund==quoted; → `CANCELLED_EARLY` |
| `PLACEMENT-INT-009` | Pause/resume extends window, moves no money | P1 | `ACTIVE` | pause then resume after N | — | PAUSE→PAUSED (no money); RESUME→ACTIVE, `window_end` += paused duration |
| `PLACEMENT-INT-010` | Reconcile orphaned hold | P1 | `SCHEDULED`, `window_end` passed, never activated | run `RunReconciliation` | held escrow | `refundFull` + → `CANCELLED`; no escrow stranded |
| `PLACEMENT-INV-001` | HOLD idempotent replay | P0 | one hold key used | replay approve/pay hold | same key | `ledger.ErrDuplicate` tolerated → no second debit (MONEY-INV-006) |
| `PLACEMENT-INV-002` | Refund/recognize idempotent | P0 | already refunded / recognised | re-run leg | same key | duplicate tolerated; no double credit/recognition (MONEY-INV-010) |
| `PLACEMENT-INV-003` | Quote/pro-rata conservation kobo-exact | P0 | any quote | recompute earned+refund | integer-only | earned+refund == quoted; no minted/lost kobo (covered by `TestProRataSplit`) |
| `PLACEMENT-SEC-001` | Missing Idempotency-Key on submit/pay | P0 | valid campaign | `POST /:id/submit` or `/:id/pay` no header | no key | 400 "Idempotency-Key header required"; no state/money change |
| `PLACEMENT-SEC-002` | Ineligible creative rejected | P1 | draft with banned word / bad cta | `POST /:id/submit` | banned headline | 422 `ErrIneligible` (`INELIGIBLE`); not submitted |
| `PLACEMENT-SEC-003` | Concurrent-cap gate | P1 | merchant at `MaxConcurrentCampaigns=5` | submit a 6th | over cap | 422 `ErrIneligible`; blocked |
| `PLACEMENT-SEC-004` | Exclusive slot conflict | P1 | slot taken for window | approve/pay a clashing exclusive | overlap | 409 `ErrSlotTaken` (`SLOT_TAKEN`); not approved |
| `PLACEMENT-AUTHZ-001` | Ownership on `:id` ops (IDOR) | P0 | campaign owned by A | B quotes/submits/pays/cancels A's `:id` | B != owner | 403 `ErrForbidden`; no money moved |
| `PLACEMENT-AUTHZ-002` | Admin routes require per-route RBAC | P0 | caller lacking grant | approve/reject/suspend | no `placement.admin.*` | 403 (see `../cross-cutting/rbac-and-permissions.md`) |
| `PLACEMENT-AUTHZ-003` | Public landing/events need NO auth but leak nothing owner-scoped | P1 | anonymous | `GET /landing`, `POST /events` | no token | 200/202; only served/house items + accepted count; no campaign internals |
| `PLACEMENT-SEC-005` | Flag-off inaccessible | P0 | `FEATURE_PLACEMENT_ENABLED=off` | call any `/placement/*` route | — | Route not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

Real FSM in `model.go` (`transitions` map, `canTransition`, `State.IsTerminal`) — verified by `placement_test.go` `TestCanTransition`/`TestIsTerminal`. Terminals (`COMPLETED`, `REJECTED`, `CANCELLED`, `CANCELLED_EARLY`, `SUSPENDED`) have no out-edges.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `DRAFT` | submit | `SUBMITTED` | eligibility re-checked | `PLACEMENT-FSM-001` |
| `SUBMITTED` | queue review | `UNDER_REVIEW` | — | `PLACEMENT-FSM-002` |
| `UNDER_REVIEW` | approve + paid | `SCHEDULED` | escrow HOLD + exclusive reservation | `PLACEMENT-FSM-003` |
| `UNDER_REVIEW` | approve + insufficient | `PENDING_PAYMENT` | no hold | `PLACEMENT-FSM-004` |
| `UNDER_REVIEW` | reject / request-info | `REJECTED` / `NEEDS_MORE_INFO` | reason recorded | `PLACEMENT-FSM-005` |
| `NEEDS_MORE_INFO` | resubmit | `UNDER_REVIEW` | — | `PLACEMENT-FSM-006` |
| `PENDING_PAYMENT` | pay retry ok | `SCHEDULED` | escrow HOLD | `PLACEMENT-FSM-007` |
| `PENDING_PAYMENT` | cancel | `CANCELLED` | no money held | `PLACEMENT-FSM-008` |
| `SCHEDULED` | scheduler @ start | `ACTIVE` | — | `PLACEMENT-FSM-009` |
| `SCHEDULED` | cancel before start | `CANCELLED` | full refund | `PLACEMENT-FSM-010` |
| `ACTIVE` | scheduler @ end | `COMPLETED` | recognise full revenue | `PLACEMENT-FSM-011` |
| `ACTIVE`⇄`PAUSED` | pause / resume | `PAUSED` / `ACTIVE` | no money; window extended on resume | `PLACEMENT-FSM-012` |
| `ACTIVE`/`PAUSED` | early cancel / admin suspend | `CANCELLED_EARLY` / `SUSPENDED` | pro-rata recognise + refund | `PLACEMENT-FSM-013` |
| illegal (e.g. `DRAFT`→`ACTIVE`, `SCHEDULED`→`COMPLETED`) | any | — | rejected `ErrBadState` (409); guarded no-op | `PLACEMENT-FSM-014` |
| any terminal | any | — | rejected (`IsTerminal`) | `PLACEMENT-FSM-015` |

## 6. Security & abuse cases

- **Server-side pricing:** the quote is computed server-side (`quotePriceKobo` from the zone's rate/version + duration + tier multiplier) — the client never supplies the amount, so there is no re-pricing/tamper surface. `TestQuotePriceKobo` locks the math.
- **Conservation:** every early stop splits via `proRataSplit` where `earned+refund == quoted` exactly (integer truncation favours refund, never over-charges); HOLD/RECOGNIZE/REFUND are the only money verbs and each is idempotent (`PLACEMENT-INV-001/002`).
- **IDOR:** `PLACEMENT-AUTHZ-001` — every `:id` op resolves `ownedCampaign` and rejects a non-owner; identity is the token `user_id`.
- **Public endpoints:** `landing`/`events` are intentionally unauthenticated (consumer landing pages can't send a Bearer) — assert they expose only served/house items + an accepted count, never owner-scoped campaign internals (`PLACEMENT-AUTHZ-003`).
- **Eligibility fail-safe:** `ExternalEligibility` defaults to `PermissiveExternalEligibility` (dev/CI) — it ALLOWS everything and MUST be replaced before go-live. Flag this as a known gap: KYC-tier + subject-ownership gates are not yet enforced (see the TODO in `eligibility.go`); cross-reference `../cross-cutting/kyc-and-tiers.md`.
- **Tier limit fail-closed:** the escrow HOLD runs through `wallet.Debit`, which applies the tier-limit check fail-closed before posting.
- **Audit:** every transition + money leg writes an immutable `placement_audit_log` row with the actor (AUDIT-SEC-001).
- Inherit `../cross-cutting/money-invariants.md`.

## 7. Automated specs to add

- `internal/placement/service_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`): approve HOLD, expiry RECOGNIZE, cancel REFUND, early-cancel pro-rata split, each with idempotent replay + escrow conservation; exclusive-slot conflict; optimistic-lock conflict (`PLACEMENT-INT-002/006/007/008`, `PLACEMENT-INV-001/002`, `PLACEMENT-SEC-004`). TODO.
- `internal/placement/eligibility_gate_test.go` — cap/cooldown gates + a non-permissive external stub denying merchant/subject → `ErrIneligible` (`PLACEMENT-SEC-002/003`). TODO.
- `internal/placement/scheduler_test.go` — `RunActivations`/`RunExpirations`/`RunReconciliation` sweep behaviour incl. skip-ineligible and orphaned-hold refund (`PLACEMENT-INT-005/006/010`). TODO.
- `internal/placement/authz_test.go` — `ownedCampaign` IDOR denials + admin per-route RBAC (`PLACEMENT-AUTHZ-001/002`). TODO.

## 8. Coverage target & exit criteria

Tier-1 pure-logic floor ≥ 85% (pricing/pro-rata/resolver/creative already strong via `placement_test.go`). Exit criteria (release-ready): `PLACEMENT-INT-002/006/007/008` (HOLD/RECOGNIZE/REFUND/pro-rata), `PLACEMENT-INV-001/002/003` (idempotency + conservation), `PLACEMENT-SEC-001/004` (missing key, slot conflict), `PLACEMENT-AUTHZ-001/002` (IDOR + admin RBAC) all green; the Permissive external-eligibility gap tracked and closed before go-live; flag-off `PLACEMENT-SEC-005` verified; no S1 open.
