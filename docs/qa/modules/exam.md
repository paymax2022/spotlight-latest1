# Module: Academy Exam (CBT Arenas)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no (entitlement checked, but no ledger move) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_EXAM_ENABLED` (`FlagExam` = `academy.exam`; registered inside `if examEnabled`)
**Code:** `backend/internal/academy/exam/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go`, `exam_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyExam`).
**Slug:** `EXAM`

## 1. Overview & scope

CBT exam arenas (CCE/BECE/WASSCE/NECO/UTME/NABTEB): admins define arenas, blueprints, and UTME subject
combinations; learners begin attempts, pause/resume, submit, and read scored results. The attempt is a
guarded FSM (`created → started → paused/submitted → scored → reviewed`) with a **server-authoritative
deadline** (derived from the blueprint, not extended on resume) and immutable responses once submitted.
Scoring is pure: UTME 400-scale or a WASSCE 9-band ladder (custom bands via `scoring_rules`), with a
composite readiness = coverage × mastery × mock. Entry is entitlement-gated via an injected
`EntitlementChecker` (nil = default-allow for Phase-1/dev). No money moves. Begin/submit carry an
`Idempotency-Key`. Admin routes gated `academy.exam`.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (admin `academy.exam`),
`../cross-cutting/feature-flags-and-audit.md` (exam flag-off).

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin group `/exam` (base `/api/academy/admin`) guarded
`RequirePermission("academy.exam")`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List/get arenas, blueprints | `GET /exam/arenas`, `/arenas/:id`, `/arenas/:id/blueprints` | member (auth) | no |
| Begin attempt | `POST /exam/attempts` | member; owner + `Idempotency-Key` + entitlement | no |
| Pause / resume attempt | `POST /exam/attempts/:id/pause`, `/resume` | member; owner | no |
| Submit attempt | `POST /exam/attempts/:id/submit` | member; owner + `Idempotency-Key` | no |
| Get attempt / result | `GET /exam/attempts/:id`, `/attempts/:id/result` | member; owner | no |
| UTME combinations | `GET /exam/utme/combinations` | member | no |
| Arena/blueprint/combination CRUD | `POST/PUT/DELETE /exam/{arenas,blueprints,combinations}` | `academy.exam` | no |

Enums: `AttemptState` = created|started|paused|submitted|scored|reviewed; `ArenaStatus` =
draft|active|archived. `Attempt.ServerDeadline` is server-authoritative; late submits accepted but
flagged `integrity["late"]`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Attempt FSM legal/illegal | unit/fsm | `exam_test.go::TestCanAttempt_Allowed`, `TestCanAttempt_Illegal` | AUTOMATED |
| Submit idempotency (frozen/live states) | unit/fsm | `exam_test.go::TestSubmit_Idempotency_FrozenStatesRejectResubmit`, `TestSubmit_Idempotency_LiveStatesAcceptSubmit` | AUTOMATED |
| UTME 400-scale scoring | unit | `exam_test.go::TestScore_UTME400Scale` | AUTOMATED |
| Grade band default/custom | unit | `exam_test.go::TestScore_GradeBand_Default`, `TestScore_GradeBand_CustomBands` | AUTOMATED |
| Readiness (mock-only / composite) | unit | `exam_test.go::TestScore_Readiness_MockOnly_WhenNoMastery`, `TestScore_Readiness_Composite` | AUTOMATED |
| Late marking / server deadline | unit | `exam_test.go::TestDeadline_LateMarking`, `TestServerDeadline_DerivedFromBlueprint` | AUTOMATED |
| Attempt lifecycle against DB | integration | — | TODO |
| Entitlement gate on begin | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `EXAM-INT-001` | Begin attempt sets server deadline | P0 | active arena + blueprint (`total_seconds`) | `POST /exam/attempts` + key | key ≥8 | Attempt `created→started`; `ServerDeadline = started + total_seconds` |
| `EXAM-INT-002` | Pause then resume | P1 | attempt `started` | pause, then resume | — | `started→paused→started`; deadline NOT extended on resume |
| `EXAM-INT-003` | Submit scores attempt | P0 | attempt `started`/`paused` | `POST /exam/attempts/:id/submit` + key | — | `submitted→scored`; result computed; responses frozen |
| `EXAM-INT-004` | UTME 400-scale result | P1 | UTME blueprint, 3/4 correct | submit | — | Overall `300` on 400-scale |
| `EXAM-INT-005` | WASSCE grade bands | P1 | default bands | submit 100%/50%/0% | — | A1 / C6 / F9 respectively |
| `EXAM-INT-006` | Late submission flagged | P1 | attempt past deadline | submit after deadline | late | Accepted but `integrity["late"]=true`; exact-deadline = not late |
| `EXAM-VAL-001` | Begin missing idempotency key | P1 | active arena | `POST /exam/attempts` no key | — | Rejected (idempotency required) |
| `EXAM-INV-001` | Submit idempotent on live/frozen | P0 | submitted attempt | re-submit | same | Frozen states return as-is (no re-score); live states accept once (MONEY-INV-006 analogue) |
| `EXAM-SEC-001` | Responses immutable post-submit | P0 | submitted attempt | attempt to change a response | — | Rejected — submitted/scored/reviewed freeze responses |
| `EXAM-AUTHZ-001` | Attempt owner-scoped (IDOR) | P0 | attempt owned by A | B `GET /exam/attempts/:id` / submit | A's attempt | 403/404; B cannot read/submit A's attempt |
| `EXAM-AUTHZ-002` | Arena CRUD denied without permission | P0 | caller lacks `academy.exam` | `POST /exam/arenas` | — | 403 `forbidden` |
| `EXAM-AUTHZ-003` | Entitlement gate on begin | P1 | entitlement checker denies | `POST /exam/attempts` | — | Blocked when checker denies (nil checker = default-allow in dev) |
| `EXAM-SEC-002` | Exam flag-off route inaccessible | P0 | `FEATURE_ACADEMY_EXAM_ENABLED` off | Call any exam endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Attempt** (`allowedAttempt`, `canAttempt`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| created | start | started | server deadline set | `EXAM-FSM-001` |
| started | pause | paused | — | `EXAM-FSM-002` |
| started / paused | submit | submitted | responses frozen | `EXAM-FSM-003` |
| paused | resume | started | deadline NOT extended | `EXAM-FSM-004` |
| submitted | score | scored | result computed | `EXAM-FSM-005` |
| scored | review | reviewed (terminal) | — | `EXAM-FSM-006` |

`isTerminalForResponses` = submitted/scored/reviewed (freeze). Submit is idempotent: terminal states
return as-is; guarded `WHERE state=$from` UPDATE. Illegal transitions rejected
(`TestCanAttempt_Illegal`): `created→submitted`, `submitted→started`, `reviewed→*`.

## 6. Security & abuse cases

- **Server-authoritative deadline:** timing is server-side; resume does not extend the deadline; late
  submits are flagged not silently accepted-as-on-time (`EXAM-INT-002/006`).
- **Immutable responses** after submit (`EXAM-SEC-001`).
- **Idempotent submit** — no double-score (`EXAM-INV-001`).
- **IDOR:** attempts scoped to token identity (`EXAM-AUTHZ-001`).
- **Entitlement gate** on begin (`EXAM-AUTHZ-003`); admin CRUD gated `academy.exam`.
- **Flag-off:** exam gate (`EXAM-SEC-002`).

## 7. Automated specs to add

- `exam/live_db_attempt_test.go` — full begin→pause→resume→submit→score against DB with server
  deadline + response-freeze enforcement. TODO.
- `exam/entitlement_gate_test.go` — begin blocked when checker denies, allowed when nil/allow. TODO.
- `exam/authz_test.go` — attempt owner-scope; arena CRUD denied without `academy.exam`. TODO.

## 8. Coverage target & exit criteria

Pure scoring/FSM/deadline logic covered by `exam_test.go` (≥ 85%). Exit: attempt lifecycle + response
freeze + server-deadline proven against DB; idempotent submit (no double-score); IDOR + entitlement +
admin authz green; exam flag-off inaccessible.
