# Module: Academy Trade (Vocational Tracks + Credential Commerce)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no (credential issuance, not value movement) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_CREDENTIALS_ENABLED` (shares `FlagCredentials` = `academy.credentials`; registered inside `if credentialsEnabled` alongside credentials)
**Code:** `backend/internal/academy/trade/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go`, `trade_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyTrade`; `credentials.NewService(pool, nil)` injected as `CredentialIssuer`).
**Slug:** `TRADE`

## 1. Overview & scope

Vocational trade tracks: hub, tracks, modules, lessons, projects, skill-assessments, and mentor
matching. Despite the "commerce" framing, **there is no money path** — the commerce here is
**credential issuance**, not value movement. Passing a skill assessment issues a verifiable credential
(via the injected `CredentialIssuer` = `credentials.NewService`) inside the grading transaction,
at-most-once per `academy_skill_attempts.idempotency_key`. Project submissions and mentor matches are
guarded FSMs. Admin CRUD is gated by `academy.content`; submission review by `academy.assessment`.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (dual admin slugs `academy.content` / `academy.assessment`),
`../cross-cutting/feature-flags-and-audit.md` (credentials flag-off). Note: no
`money-invariants.md` — this module moves no money, but `Idempotency-Key` still gates
`TakeSkillAssessment` to make credential issuance exactly-once.

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Hub / tracks / module / project | `GET /trade/hub`, `/tracks`, `/modules/:id`, `/projects/:id` | member (auth) | no |
| Submit project | `POST /trade/projects/:id/submit` | member; owner | no |
| My submissions | `GET /trade/submissions` | member; owner | no |
| Assessments list/get | `GET /trade/assessments`, `/assessments/:id` | member | no |
| Take skill assessment | `POST /trade/assessments/:id/take` | member; owner + `Idempotency-Key` | no (issues credential on pass) |
| Mentors list / request / close match | `GET /trade/mentors`, `POST /trade/mentors/:id/request`, `POST /trade/matches/:id/close` | member | no |
| Modules/lessons/projects/skill-assessments CRUD | `POST/PUT /trade/modules`,`/lessons`,`/projects`,`/skill-assessments` | `academy.content` | no |
| Create mentor / accept match | `POST /trade/mentors`, `POST /trade/matches/:id/accept` | `academy.content` | no |
| Review submission | `POST /trade/submissions/:id/review` | `academy.assessment` | no |

`CredentialIssuer.IssueTradeCredential(ctx, userID, tradeTrack, title)`; nil → `noopIssuer`.
`PassThreshold` drives pass/fail (`grade(score, threshold) = score ≥ threshold`).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Submission FSM legal/illegal | unit/fsm | `trade_test.go::TestCanSubmission_Allowed`, `TestCanSubmission_Illegal`, `TestValidSubmissionState` | AUTOMATED |
| Mentor-match FSM | unit/fsm | `trade_test.go::TestCanMatch_Transitions` | AUTOMATED |
| Grade threshold math | unit | `trade_test.go::TestGrade` | AUTOMATED |
| Pass issues credential once | unit/inv | `trade_test.go::TestTakeAssessment_PassIssuesCredentialOnce` | AUTOMATED |
| Fail does not issue | unit | `trade_test.go::TestTakeAssessment_FailDoesNotIssue` | AUTOMATED |
| Take requires idempotency key | unit/inv | `trade_test.go::TestTakeAssessment_RequiresIdempotencyKey` | AUTOMATED |
| Noop issuer nil-safe | unit | `trade_test.go::TestNoopIssuer` | AUTOMATED |
| Pass issues via real credentials service | integration | — | TODO |
| Admin authz split | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `TRADE-INT-001` | Browse hub/tracks/modules | P2 | seeded tracks | `GET /trade/hub`, `/tracks`, `/modules/:id` | — | 200; catalog rows |
| `TRADE-INT-002` | Submit a project | P1 | project exists | `POST /trade/projects/:id/submit` | — | Submission `submitted` |
| `TRADE-INT-003` | Review submission (pass) | P1 | submission `submitted`; reviewer holds `academy.assessment` | `POST /trade/submissions/:id/review` | pass | `submitted→reviewed→passed` |
| `TRADE-INT-004` | Pass skill assessment issues one credential | P0 | assessment; passing answers | `POST /trade/assessments/:id/take` + key | ≥ threshold | Credential issued exactly once inside grading tx |
| `TRADE-INT-005` | Fail issues no credential | P1 | assessment; failing answers | `POST /trade/assessments/:id/take` + key | < threshold | Attempt `graded`, no credential; issuer not called |
| `TRADE-INT-006` | Mentor request + accept | P2 | mentor exists | `POST /trade/mentors/:id/request`, admin `POST /trade/matches/:id/accept` | — | Match `requested→active` |
| `TRADE-VAL-001` | Take missing idempotency key | P0 | assessment | `POST /trade/assessments/:id/take` no key | — | `ErrIdempotencyRequired` → 400 |
| `TRADE-INV-001` | Take replay does not re-issue | P0 | passed attempt | Re-POST take same key | same key | Returns original attempt; no second credential (unique `idempotency_key`) |
| `TRADE-AUTHZ-001` | CRUD denied without `academy.content` | P0 | caller lacks perm | `POST /trade/modules` | — | 403 `forbidden` |
| `TRADE-AUTHZ-002` | Review denied without `academy.assessment` | P0 | caller has `academy.content` only | `POST /trade/submissions/:id/review` | — | 403 (distinct slug) |
| `TRADE-AUTHZ-003` | Submissions owner-scoped (IDOR) | P1 | user A submitted | user B `GET /trade/submissions` | — | B sees only own submissions |
| `TRADE-FSM-001` | Illegal submission transition rejected | P1 | submission `submitted` | attempt `submitted→passed` (skip review) | skip | Rejected `ErrIllegalTransition` |
| `TRADE-SEC-001` | Credentials flag-off route inaccessible | P0 | `FEATURE_ACADEMY_CREDENTIALS_ENABLED` off | Call any trade endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Project submission** (`canSubmission`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| submitted | review | reviewed | — | `TRADE-FSM-002` |
| reviewed | pass | passed (terminal) | — | `TRADE-FSM-003` |
| reviewed | fail | failed (terminal) | — | `TRADE-FSM-004` |

**Mentor match** (`canMatch`): `requested → active`, `requested → closed` (decline), `active → closed`;
`closed` terminal. `TRADE-FSM-005`. Illegal transitions asserted rejected (`TestCanSubmission_Illegal`,
`TestCanMatch_Transitions`): skip-review, backwards from terminal, re-entering terminal.

## 6. Security & abuse cases

- **Exactly-once credential issuance:** on pass, credential issued within the grading tx, at-most-once
  via unique `academy_skill_attempts.idempotency_key`; replay returns the original attempt
  (`TRADE-INV-001`). `Idempotency-Key` mandatory even though no money moves.
- **Dual admin authz:** CRUD requires `academy.content`; submission review requires
  `academy.assessment` — assert independently (`TRADE-AUTHZ-001/002`).
- **IDOR/owner-scope** on submissions (`TRADE-AUTHZ-003`).
- **`RoleUpgrader` nil:** credential Apply records routing only — no server-side privileged role
  auto-grant (see credentials module).
- **Flag-off:** shares the credentials gate (`TRADE-SEC-001`).

## 7. Automated specs to add

- `trade/live_db_take_test.go` — `TakeSkillAssessment` against real `credentials.NewService`: pass
  issues one credential, replay no re-issue, fail issues none. TODO.
- `trade/authz_test.go` — `academy.content` vs `academy.assessment` slug split; submission owner-scope.
  TODO.

## 8. Coverage target & exit criteria

Pure FSM + grading + issuance-idempotency logic covered by `trade_test.go`. Exit: pass/fail issuance
exactly-once proven end-to-end; illegal transitions rejected; dual admin authz enforced;
credentials flag-off inaccessible.
