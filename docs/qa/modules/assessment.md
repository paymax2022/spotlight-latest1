# Module: Academy Assessment (Question Bank + Practice)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_EXAM_ENABLED` (shares the exam sub-flag; registered inside `if examEnabled` alongside `exam`)
**Code:** `backend/internal/academy/assessment/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go` (**no `*_test.go` in package**); wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyAssessment`).
**Slug:** `ASSESSMENT`

## 1. Overview & scope

Question bank + adaptive practice. Learners fetch practice (answer key stripped), submit answers, and
read mastery/progress; admins CRUD question items through a review lifecycle. Two guarded FSMs live
here: the **item lifecycle** (`draft → review → approved → retired`) and the **progression** projection
(`not_started → in_progress → practiced → mastered → exam_ready`) driven by pure threshold logic. Item
authoring is gated `academy.assessment`; the review transition is gated by the stricter
`academy.assessment.review`. No money. This package has **no in-package tests** — its logic is
exercised indirectly; adding table tests is the top gap.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (`academy.assessment` vs `academy.assessment.review`),
`../cross-cutting/feature-flags-and-audit.md` (exam flag-off).

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin group `/question-bank` (base `/api/academy/admin`).

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Get practice (answer key stripped) | `GET /practice` | member (auth) | no |
| Submit practice | `POST /practice/submit` | member; owner | no |
| Get mastery / progress | `GET /mastery`, `GET /progress` | member; owner | no |
| List / create item | `GET/POST /question-bank/items` | `academy.assessment` | no |
| Get / update item | `GET/PUT /question-bank/items/:id` | `academy.assessment` | no |
| Transition item | `POST /question-bank/items/:id/transition` | `academy.assessment.review` | no |
| Item analysis | `GET /question-bank/item-analysis` | `academy.assessment` | no |

Enums: `ItemStatus` = draft|review|approved|retired; `MasteryState` =
not_started|in_progress|practiced|mastered|exam_ready. `MasteryThresholds` (MinPracticeAttempts=3,
MasteryScore=0.7). Progress events: practice_recorded|practiced|mastered|exam_ready|remediated.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Item lifecycle transitions | unit/fsm | — (no in-package test) | TODO |
| Progression transitions + threshold | unit/fsm | — | TODO |
| Practice hides answer key | integration | — | TODO |
| Submit updates mastery/progress | integration | — | TODO |
| Item authoring authz split | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ASSESSMENT-INT-001` | Practice strips answer key | P0 | approved items for objective | `GET /practice` | — | Items returned WITHOUT `answer` field (no answer leak) |
| `ASSESSMENT-INT-002` | Submit records mastery/progress | P1 | practice fetched | `POST /practice/submit {objectiveId, answers}` | — | `PracticeResult` returned; mastery + append-only progress event updated |
| `ASSESSMENT-INT-003` | Reach mastery after threshold | P1 | ≥3 attempts, score ≥ 0.7 | submit passing practice | 0.7 | Mastery state advances to `mastered` per thresholds |
| `ASSESSMENT-INT-004` | Create item defaults to draft | P1 | holder `academy.assessment` | `POST /question-bank/items` | — | Item `draft`; status not settable via create/update |
| `ASSESSMENT-INT-005` | Transition item draft→review→approved | P1 | draft item; reviewer holds review slug | `POST /question-bank/items/:id/transition {to}` | — | Legal transitions applied |
| `ASSESSMENT-VAL-001` | Difficulty out of range rejected | P2 | holder | create item difficulty 1.5 | invalid | 400 (difficulty 0..1) |
| `ASSESSMENT-AUTHZ-001` | Item CRUD denied without permission | P0 | caller lacks `academy.assessment` | `POST /question-bank/items` | — | 403 `forbidden` |
| `ASSESSMENT-AUTHZ-002` | Transition denied without review slug | P0 | caller has `academy.assessment` only | `POST /question-bank/items/:id/transition` | — | 403 (stricter `academy.assessment.review`) |
| `ASSESSMENT-AUTHZ-003` | Practice/mastery owner-scoped (IDOR) | P1 | user A practiced | user B `GET /mastery` | — | B sees only own mastery |
| `ASSESSMENT-FSM-001` | Illegal item transition rejected | P1 | item `draft` | transition `draft→approved` (skip) | skip | Rejected (not in table) |
| `ASSESSMENT-FSM-002` | Retired item is terminal | P1 | item `retired` | transition to any state | — | Rejected |
| `ASSESSMENT-SEC-001` | Exam flag-off route inaccessible | P0 | `FEATURE_ACADEMY_EXAM_ENABLED` off | Call any assessment endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Item lifecycle** (`canTransitionItem`): `draft→review|retired`; `review→approved|draft(bounce)|
retired`; `approved→retired`; `retired` terminal. `ASSESSMENT-FSM-001/002`.

**Progression** (`canProgress`): `not_started→in_progress→practiced→mastered→exam_ready`; `exam_ready`
terminal; plus idempotent self-loop and remediation (any non-`not_started` → `in_progress`).
`nextStateForPractice` is the pure threshold logic; `progressEventTypeFor` maps reached state to event
type. `ASSESSMENT-FSM-003` (progression).

## 6. Security & abuse cases

- **Answer-key exposure:** practice endpoints must strip `answer` — critical no-leak invariant
  (`ASSESSMENT-INT-001`).
- **Authz split:** authoring `academy.assessment` vs review `academy.assessment.review` — assert
  independently (`ASSESSMENT-AUTHZ-001/002`).
- **IDOR:** mastery/progress/practice scoped to token identity.
- **Immutable progress:** progress events are append-only.
- **Flag-off:** shares the exam gate (`ASSESSMENT-SEC-001`).

## 7. Automated specs to add

- `assessment/statemachine_test.go` — item + progression transition tables (legal/illegal/terminal/
  remediation), mirroring `exam_test.go` / `progression_test.go` conventions. TODO (fills the missing
  in-package suite).
- `assessment/practice_answer_strip_test.go` — practice payload never contains `answer`. TODO.
- `assessment/authz_test.go` — authoring vs review slug split. TODO.

## 8. Coverage target & exit criteria

Pure FSM/threshold logic ≥ 85% once tests added. Exit: answer-key strip proven; item + progression FSM
legal/illegal proven; authoring vs review authz enforced; exam flag-off inaccessible.
