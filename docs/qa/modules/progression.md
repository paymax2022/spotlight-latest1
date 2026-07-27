# Module: Academy Progression (Adaptive Learning)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_SPINE_ENABLED` (`FlagSpine` = `academy.spine`; registered only inside `if spineEnabled`)
**Code:** `backend/internal/academy/progression/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go`, `progression_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyProgression`).
**Slug:** `PROGRESSION`

## 1. Overview & scope

Adaptive learning paths and recommendations. A learner builds a path per subject (steps with a
`locked → available → in_progress → done` lifecycle, plus `done → in_progress` remediation), advances
steps, requests adaptive practice (pure weakest-first objective selection + scaffolded item picking),
and reads recommendations. Mastery is a **read-only projection** of `academy_mastery_records` — reused,
never duplicated. All the ranking/selection logic is pure (`statemachine.go`) and unit-tested. Admin
routes tune adaptive config. No money.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (admin config gated `academy.assessment` read /
`academy.curriculum` write), `../cross-cutting/feature-flags-and-audit.md` (spine flag-off).

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin` group `/progression`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Get path for subject | `GET /progression/paths/:subjectId` | member (owner) | no |
| Build path | `POST /progression/paths` | member (owner) | no |
| Advance step | `POST /progression/steps/:objectiveId/advance` | member (owner) | no |
| Adaptive practice | `POST /progression/practice/adaptive` | member (owner) | no |
| Recommendations | `GET /progression/recommendations` | member (owner) | no |
| Get adaptive config | `GET /progression/adaptive-config` | `academy.assessment` | no |
| Upsert adaptive config | `PUT /progression/adaptive-config` | `academy.curriculum` | no |

Enums: `PathState` = active|completed; `PathStepState` = locked|available|in_progress|done; Mastery
state = not_started|in_progress|practiced|mastered|exam_ready. `DefaultMasteryThreshold = 0.7`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Path-step legal transitions | unit/fsm | `progression_test.go::TestCanStepAllowed` | AUTOMATED |
| Path-step illegal transitions | unit/fsm | `progression_test.go::TestCanStepIllegal` | AUTOMATED |
| Step event mapping | unit | `progression_test.go::TestStepEventTypeFor` | AUTOMATED |
| Weak-objective selection + threshold | unit | `progression_test.go::TestSelectWeakObjectives`, `TestSelectWeakObjectivesThresholdFallback`, `TestIsWeak` | AUTOMATED |
| Item picking round-robin/difficulty/limit | unit | `progression_test.go::TestPickItemsRoundRobinAndDifficulty`, `TestPickItemsLimit`, `TestPickItemsIgnoresUnrequested` | AUTOMATED |
| Path build ordering | unit | `progression_test.go::TestPathBuildOrdering` | AUTOMATED |
| Recommendation scoring | unit | `progression_test.go::TestRecommendationScoreGapRanking`, `TestRecommendationScoreBoosts`, `TestRecommendationScoreMasteredZero` | AUTOMATED |
| Advance step against DB + progress event | integration | — | TODO |
| Admin config authz split | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `PROGRESSION-INT-001` | Build path for subject | P1 | curriculum objectives exist | `POST /progression/paths {subjectId}` | — | Path built; first step `available`, rest `locked` (ordering) |
| `PROGRESSION-INT-002` | Advance step forward | P1 | step `available` | `POST /progression/steps/:objectiveId/advance` | — | `available→in_progress→done`; progress event emitted |
| `PROGRESSION-INT-003` | Remediation regresses done step | P2 | step `done`, failed re-check | advance triggers remediation | — | `done→in_progress` with `remediated` event |
| `PROGRESSION-INT-004` | Adaptive practice returns weakest-first | P1 | mastery rows below threshold | `POST /progression/practice/adaptive {limit}` | threshold 0.7 | Items for weakest objectives, easier-first, balanced round-robin, ≤ limit |
| `PROGRESSION-INT-005` | Recommendations ranked by gap | P2 | mixed mastery | `GET /progression/recommendations` | — | Highest gap first; in_progress + on-path boosts applied; mastered scores 0 |
| `PROGRESSION-VAL-001` | Missing subjectId rejected | P2 | authed | `POST /progression/paths {}` | — | 400 |
| `PROGRESSION-AUTHZ-001` | Path/practice is owner-scoped (IDOR) | P0 | user A has a path | user B reads/advances A's path | A's subject/objective | B sees only own progression; cannot advance A's steps |
| `PROGRESSION-AUTHZ-002` | Config read gated `academy.assessment` | P1 | caller lacks perm | `GET /progression/adaptive-config` | — | 403 `forbidden` |
| `PROGRESSION-AUTHZ-003` | Config write gated `academy.curriculum` | P1 | caller has read but not write perm | `PUT /progression/adaptive-config` | — | 403 (distinct write slug) |
| `PROGRESSION-SEC-001` | Mastery is read-only projection | P1 | mastery records exist | advance/practice | — | No duplicate mastery rows written; single source of truth reused |
| `PROGRESSION-SEC-002` | Spine flag-off route inaccessible | P0 | `FEATURE_ACADEMY_SPINE_ENABLED` off | Call any progression endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Path step** (`stepTransitions`, `canStep` — self-transition rejected):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| locked | unlock | available | `step_available` event | `PROGRESSION-FSM-001` |
| available | start | in_progress | `step_started` event | `PROGRESSION-FSM-002` |
| in_progress | complete | done | `step_done` event | `PROGRESSION-FSM-003` |
| done | remediate | in_progress | `step_remediated` event | `PROGRESSION-FSM-004` |

Illegal transitions rejected (`TestCanStepIllegal`): skips (`locked→done`), backwards (except the
single `done→in_progress` remediation), self-loops, unknown states.

## 6. Security & abuse cases

- **IDOR/owner-scope:** paths, steps, practice, recommendations are keyed to the token `user_id`
  (`PROGRESSION-AUTHZ-001`).
- **Split admin authz:** config **read** requires `academy.assessment`, **write** requires
  `academy.curriculum` — assert both independently (`PROGRESSION-AUTHZ-002/003`).
- **Projection integrity:** mastery reused read-only; never a parallel/duplicated store.
- **Flag-off:** spine-gated (`PROGRESSION-SEC-002`).

## 7. Automated specs to add

- `progression/service_advance_test.go` — advance against DB emits the correct progress event and
  guarded transition; remediation path. TODO.
- `progression/config_authz_test.go` — read vs write config slug split enforced. TODO.

## 8. Coverage target & exit criteria

Pure selection/FSM/scoring logic already covered by `progression_test.go`. Exit: guarded advance +
progress events proven at service layer; owner-scope/IDOR green; admin config slug split enforced;
spine flag-off inaccessible.
