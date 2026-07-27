# Module: Learn Center

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_LEARN_ENABLED` (`config.FeatureLearnEnabled`, default off)
**Code:** `backend/internal/learn/` (`routes.go`, `handler.go`, `service.go`, `model.go`, `admin.go`); route wiring `backend/internal/app/learn_routes.go` and `backend/internal/app/router.go` (~L371, flag gate); tests `backend/tests/learn/quiz_scoring_test.go`, `backend/tests/learn/live_db_integration_test.go`.
**Slug:** `LEARN` (uppercase, used in Case IDs)

## 1. Overview & scope

The Learn Center is an education-first, **read-mostly** surface (learning paths → lessons →
optional quizzes + a glossary) served to authenticated mobile members under `/api/v1/learn/*`,
plus an RBAC-gated content-authoring surface under `/api/v1/learn/admin/*`. It has **no money
path** — there are no balances, no kobo, no ledger. The two behaviours that matter for testing
are (1) **server-authoritative quiz scoring** — the client submits only `questionId → optionId`
and the server alone decides score/pass, never trusting the client — and (2) the **answer-key
never leaving the server**: the member-facing `GetQuiz` actively zeroes every option's `correct`
flag, and only the internal scoring load (`withKey=true`) sees the key. A secondary behaviour is
the best-effort **lesson-progress** side effect: reading a lesson marks it complete for the
caller (idempotent), advancing the path's per-learner `progressPct`.

Because there is no money path, `../cross-cutting/money-invariants.md` and
`../cross-cutting/kyc-and-tiers.md` do **not** apply — assert their absence rather than assuming a
tier/KYC gate. The applicable cross-cutting files (not repeated here) are
`../cross-cutting/authentication.md` (member group carries `RequireAuthContext`; Bearer→Supabase;
suspended/locked/deleted → 403 account restricted; spoofed body `user_id` ignored),
`../cross-cutting/rbac-and-permissions.md` (admin group additionally requires
`RequirePermission("learn.admin.manage")`, 403 fail-closed / 401), and
`../cross-cutting/feature-flags-and-audit.md` (flag-off → 404 not 500, `FLAG-SEC-001`; audit
`AUDIT-INT-00x`).

## 2. Services / endpoints in scope

Member group `r.Group("/api/v1/learn")` uses `middleware.RequireAuthContext` (mirrors `user_id`
onto the gin context via `c.GetString("user_id")`). Admin group `r.Group("/api/v1/learn/admin")`
additionally uses `middleware.RequirePermission(rbac, "learn.admin.manage")`. Note the member
group does **not** add `requireUserID()`; the GET reads are "public-to-members" (any valid token),
and only `SubmitQuiz` hard-requires a non-empty `user_id` (handler returns **401** on empty).

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List published paths (+caller progress) | `GET /api/v1/learn/paths` | `RequireAuthContext` | no |
| Single published path | `GET /api/v1/learn/paths/:id` | `RequireAuthContext` | no |
| Single lesson (side effect: mark read) | `GET /api/v1/learn/lessons/:id` | `RequireAuthContext` | no |
| Quiz for a lesson (answer key scrubbed) | `GET /api/v1/learn/lessons/:id/quiz` | `RequireAuthContext` | no |
| **Submit quiz (authoritative scoring)** | `POST /api/v1/learn/quizzes/:id/submit` | `RequireAuthContext` + non-empty `user_id` (else 401) | no |
| Glossary (alphabetical) | `GET /api/v1/learn/glossary` | `RequireAuthContext` | no |
| Admin: list all paths (incl. unpublished) | `GET /api/v1/learn/admin/paths` | + `learn.admin.manage` | no |
| Admin: CRUD path | `POST` / `PUT /:id` / `DELETE /:id` `/admin/paths` | + `learn.admin.manage` | no |
| Admin: CRUD lesson | `POST` / `PUT /:id` / `DELETE /:id` `/admin/lessons` | + `learn.admin.manage` | no |
| Admin: quiz WITH answer key | `GET /api/v1/learn/admin/quizzes/:id` | + `learn.admin.manage` | no |
| Admin: create/replace/delete quiz | `POST` / `PUT /:id` / `DELETE /:id` `/admin/quizzes` | + `learn.admin.manage` | no |
| Admin: upsert/delete glossary term | `POST /admin/glossary` / `DELETE /admin/glossary/:term` | + `learn.admin.manage` | no |

Submit body: `{ "answers": { "<questionId>": "<optionId>" } }` (`QuizAnswers` = `map[string]string`).
Response (`QuizResult`): `{ score, total, passed }` — no per-question data, no option ids, no key.
Scoring (`service.go` SubmitQuiz): `passed = total > 0 && float64(score)/float64(total) >= QuizPassRatio`
where `QuizPassRatio = 0.7` (`model.go:100`). Each submit appends a distinct
`learn_quiz_attempts` row (not idempotent — repeated submits create multiple attempt rows, by
design).

Handler error mapping (`handler.go` `httpErr`): `ErrNotFound`→404, `ErrForbidden`→403,
`ErrBadInput`→400, any other error→500 `"something went wrong"`. `SubmitQuiz` additionally:
empty `user_id`→401 `"unauthenticated"`; malformed JSON→400 `"invalid body"`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Pass threshold constant locked at 0.7 | unit | `backend/tests/learn/quiz_scoring_test.go` (`TestQuizPassRatio_IsSevenTenths`) | AUTOMATED |
| Pass/fail boundary `>=0.7` inclusive (7/10 pass, 6/10 fail) | unit | `quiz_scoring_test.go` (`TestSubmitQuiz_PassFailBoundary_Exact70Percent`) | AUTOMATED |
| Ratio math on non-round quiz (2/3 fail, 3/3 pass) | unit | `quiz_scoring_test.go` (`TestSubmitQuiz_PassFailBoundary_ThreeQuestions`) | AUTOMATED |
| Empty quiz (`total==0`) never passes | unit | `quiz_scoring_test.go` (`TestSubmitQuiz_EmptyQuiz_NeverPasses`) | AUTOMATED |
| Unanswered question scores as wrong | unit | `quiz_scoring_test.go` (`TestSubmitQuiz_UnansweredQuestionScoresAsWrong`) | AUTOMATED |
| Nonexistent/typo option id never matches | unit | `quiz_scoring_test.go` (`TestSubmitQuiz_WrongOptionIDNeverMatches`) | AUTOMATED |
| Client cannot smuggle a correctness flag (answers shape) | unit/sec | `quiz_scoring_test.go` (`TestSubmitQuiz_ClientCannotForceCorrectByGuessingIsCorrectShape`) | AUTOMATED |
| Answer key scrubbed on client-facing path | unit/sec | `quiz_scoring_test.go` (`TestGetQuiz_AnswerKeyNeverSerialized`, `TestQuizOption_JSONTagNeverOmitsCorrectButValueIsForcedFalse`) | AUTOMATED |
| Internal scoring path retains key | unit | `quiz_scoring_test.go` (`TestSubmitQuiz_InternalScoringPath_KeepsAnswerKey`) | AUTOMATED |
| `QuizResult` shape carries no key/option ids | unit/sec | `quiz_scoring_test.go` (`TestQuizResult_ShapeHasNoAnswerKey`) | AUTOMATED |
| GetQuiz scrub end-to-end vs real `is_correct=true` row | int | `backend/tests/learn/live_db_integration_test.go` (`TestLiveDB_GetQuiz_AnswerKeyNeverSerialized`) | PARTIAL (skip-gated on `DATABASE_URL`/`TEST_DATABASE_URL`) |
| Submit correct → 1/1 pass + attempt row + audit | int | `live_db_integration_test.go` (`TestLiveDB_SubmitQuiz_ScoresAuthoritativelyAndPasses`) | PARTIAL (skip-gated) |
| Submit wrong → 0/1 fail | int | `live_db_integration_test.go` (`TestLiveDB_SubmitQuiz_WrongAnswerFails`) | PARTIAL (skip-gated) |
| Empty `user_id` → `ErrForbidden`, no attempt row | int/authz | `live_db_integration_test.go` (`TestLiveDB_SubmitQuiz_RequiresAuthenticatedUser`) | PARTIAL (skip-gated) |
| GetLesson marks progress, idempotent, path % advances | int | `live_db_integration_test.go` (`TestLiveDB_GetLesson_MarksProgressAndAdvancesPathPercent`) | PARTIAL (skip-gated) |
| HTTP handler status codes (401/400/404/200 shapes) | con/int | — | TODO |
| Admin RBAC gate (`learn.admin.manage`) allowed vs denied | authz | — | TODO |
| Flag-off → routes not mounted (404) | sec | — | TODO |
| Audit event actually emitted in prod wiring | int | — | TODO (see LEARN-SEC-004 finding) |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `LEARN-INT-001` | List published paths with caller progress | P1 | flag on; `qa-user-a` token; ≥1 published path, ≥1 unpublished | `GET /paths` | — | 200; only `published` paths returned, ordered by `sort_order,title`; each `progressPct` reflects `qa-user-a`'s completed lessons (0 when none) |
| `LEARN-INT-002` | Get single published path | P1 | published path `p1` | `GET /paths/p1` | `id=p1` | 200; `lessonIds` in `sort_order,title`; `progressPct` for caller |
| `LEARN-INT-003` | Read lesson marks progress (idempotent) | P1 | path `p1` with 2 lessons | `GET /lessons/l1` twice, then `GET /lessons/l2` | — | Each read 200; after l1 path % = 50, re-read still 50 (idempotent `ON CONFLICT`), after l2 = 100 (see `TestLiveDB_GetLesson_MarksProgressAndAdvancesPathPercent`) |
| `LEARN-INT-004` | Quiz payload scrubs answer key | P0 | lesson `l1` has a quiz; correct option's `is_correct=true` in DB | `GET /lessons/l1/quiz` | — | 200; **every** option `correct=false` in response regardless of DB (see `TestLiveDB_GetQuiz_AnswerKeyNeverSerialized`) |
| `LEARN-INT-005` | Submit fully-correct quiz → pass | P0 | quiz `q1`, caller `qa-user-a` | `POST /quizzes/q1/submit` all-correct answers | `{answers:{q0:"q0-c",...}}` | 200 `{score:N,total:N,passed:true}`; one new `learn_quiz_attempts` row for caller (see `TestLiveDB_SubmitQuiz_ScoresAuthoritativelyAndPasses`) |
| `LEARN-INT-006` | Glossary alphabetical | P2 | ≥2 glossary terms | `GET /glossary` | — | 200; terms ordered by `term` |
| `LEARN-UNIT-001` | Pass boundary inclusive at exactly 70% | P0 | — | Score 7 of 10 correct | 7/10 | `passed=true` (boundary is `>=`, not `>`; see `TestSubmitQuiz_PassFailBoundary_Exact70Percent`) |
| `LEARN-UNIT-002` | 6/10 fails | P0 | — | Score 6 of 10 | 6/10 | `passed=false` (0.6 < 0.7) |
| `LEARN-UNIT-003` | Empty quiz never passes | P0 | quiz with 0 questions | Submit any answers | `total=0` | `passed=false` (the `total>0` guard prevents a vacuous pass / div-by-zero; `TestSubmitQuiz_EmptyQuiz_NeverPasses`) |
| `LEARN-UNIT-004` | Unanswered question counts as wrong | P1 | 2-question quiz | Submit answer for q0 only | `{q0:"q0-c"}` | `score=1,total=2,passed=false`; omitted answer never scored correct |
| `LEARN-UNIT-005` | Nonexistent/typo option id never matches | P0 | 1-question quiz | Submit `{q0:"nonexistent"}` | bogus optionId | `score=0`; scoring only increments when `o.ID==chosen && o.Correct` both hold |
| `LEARN-CON-001` | Malformed submit body → 400 | P1 | flag on, valid token | `POST /quizzes/q1/submit` with non-JSON / wrong shape | `"not json"` | 400 `{error:"invalid body"}`; no attempt row |
| `LEARN-CON-002` | Unpublished/missing path → 404 | P1 | path `pX` unpublished or absent | `GET /paths/pX` | `id=pX` | 404 `{error:"learn: not found"}` (member `GetPath` requires `published`) |
| `LEARN-CON-003` | Lesson with no quiz → 404 | P1 | lesson `l2` has no quiz | `GET /lessons/l2/quiz` | `id=l2` | 404 (mobile treats as "no quiz"/null) |
| `LEARN-AUTHZ-001` | Unauthenticated submit rejected | P0 | no/invalid token | `POST /quizzes/q1/submit` | valid body | 401 — `RequireAuthContext` rejects; if reached with empty `user_id`, handler returns 401 `"unauthenticated"`; no attempt row |
| `LEARN-AUTHZ-002` | Suspended account blocked | P0 | `qa-suspended`, valid token | any `GET`/submit | — | 403 account restricted (`../cross-cutting/authentication.md` AUTH-SEC-001) |
| `LEARN-AUTHZ-003` | Admin op without permission denied | P0 | `qa-user-a` lacks `learn.admin.manage` | `POST /admin/paths` | valid path body | 403 fail-closed (`../cross-cutting/rbac-and-permissions.md`); path NOT created |
| `LEARN-AUTHZ-004` | Progress/attempts scoped to caller; body `user_id` ignored | P0 | `qa-user-a` + `qa-user-b` tokens | `qa-user-a` reads lesson & submits quiz with extra `user_id:"qa-user-b"` in body | body includes victim id | Progress + attempt attributed to `qa-user-a` only (identity from token, `c.GetString("user_id")`); `qa-user-b` unaffected. Note: there is **no** read-submissions endpoint, so cross-user submission read is not exposed |
| `LEARN-SEC-001` | Answer key never leaves server | P0 | quiz with a known correct option | `GET /lessons/:id/quiz` and inspect payload | — | No option ever has `correct=true`; key exposed only via admin `GET /admin/quizzes/:id` (permission-gated). See `TestGetQuiz_AnswerKeyNeverSerialized` |
| `LEARN-SEC-002` | Client cannot self-declare a pass | P0 | quiz `q1` | Submit answers referencing wrong options / attempt to include a correctness flag | any | Scoring uses server-loaded key only; `QuizAnswers` is `map[string]string` and cannot carry correctness; `QuizResult` returns only `score/total/passed` (`TestSubmitQuiz_ClientCannotForceCorrectByGuessingIsCorrectShape`, `TestQuizResult_ShapeHasNoAnswerKey`) |
| `LEARN-SEC-003` | Flag off → routes not mounted | P0 | `FEATURE_LEARN_ENABLED=false` | `GET /paths`, `POST /quizzes/:id/submit`, `POST /admin/paths` | valid | 404 (router.go:371 never calls `RegisterLearnRoutes`); never 500 (`../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001) |
| `LEARN-SEC-004` | Audit event emitted on submit / admin mutation | P1 | flag on | Submit quiz; then admin create path | valid | `SubmitQuiz` logs `learn.quiz.submit`; admin ops log `learn.admin.*` (AUDIT-INT-001). **FINDING:** production wiring injects a **nil** auditor (`learn.NewService(pool, nil)` and `NewAdminService(pool, nil)` in `learn_routes.go:30,39`), so `s.log` is a silent no-op in prod — audit is exercised only by the test `recordingAuditor`. Flag as a real gap: wire a live sink before relying on the learn audit trail |

## 5. State-machine transitions

Not applicable — the Learn Center has **no** lifecycle/FSM. Quiz submissions are append-only:
each `POST /quizzes/:id/submit` inserts a fresh `learn_quiz_attempts` row and is explicitly
**not** idempotent (`service.go` comment: "each submission is a distinct attempt row"). The only
state transition is lesson progress `incomplete → complete`, which is idempotent via
`INSERT ... ON CONFLICT (user_id, lesson_id) DO UPDATE` and is covered behaviorally by
`LEARN-INT-003` rather than as an FSM.

## 6. Security & abuse cases

- **Answer-key leakage** — LEARN-SEC-001; the member path zeroes `correct` for every option
  (value-scrubbed, not merely JSON-tag-hidden). Admin key exposure is permission-gated
  (LEARN-AUTHZ-003).
- **Score/pass tampering** — LEARN-SEC-002 / LEARN-UNIT-00x; scoring is server-authoritative;
  the client submits only `questionId→optionId` and receives only the aggregate outcome.
- **Identity spoofing / IDOR** — LEARN-AUTHZ-004; `user_id` comes from the token, never the body;
  progress and attempts are per-caller. No endpoint reads another user's submissions.
- **AuthZ (member vs admin)** — LEARN-AUTHZ-001/002/003; admin content mutations fail-closed
  without `learn.admin.manage`.
- **No money / tier / KYC gate** — assert explicitly: there is no `Idempotency-Key`, no ledger,
  no tier or KYC check in this module. Do **not** import money-path expectations.
- **Fail-closed on flag off** — LEARN-SEC-003.
- **Best-effort side effects never break reads** — `markLessonRead` and `progress` swallow DB
  errors (return 0 / no-op) so a broken progress read never fails content delivery; assert a GET
  still returns 200 content when the progress write fails.

## 7. Automated specs to add

- `internal/learn/handler_test.go` — httptest table over a faked `*Service` seam: `SubmitQuiz`
  401 (empty `user_id`), 400 (malformed body), 200 shape (`score/total/passed` only); `GetPath`
  404 mapping; `GetQuiz` 404 (no quiz). Table-driven Go, `httptest.NewRecorder` + gin context.
- `internal/learn/admin_authz_test.go` — assert the admin group rejects a caller lacking
  `learn.admin.manage` (403) and admits one with it, and that `CreatePath`/`CreateLesson` reject
  invalid `level`/`kind` with `ErrBadInput`→400. Table-driven Go.
- `backend/tests/learn/flag_off_test.go` — build the router with `FEATURE_LEARN_ENABLED=false`
  and assert `GET /api/v1/learn/paths` and `POST /api/v1/learn/quizzes/x/submit` return 404
  (mirrors `FLAG-SEC-001`).
- `backend/tests/learn/audit_wiring_test.go` — DB-backed (gated on `TEST_DATABASE_URL`): inject a
  recording auditor into `NewService`, submit a quiz, assert exactly one `learn.quiz.submit`
  event — and add a regression asserting the production wiring path passes a non-nil sink once the
  LEARN-SEC-004 gap is fixed.

## 8. Coverage target & exit criteria

Tier-2 module, pure-logic (scoring/scrub) already well covered by
`backend/tests/learn/quiz_scoring_test.go`. Target: keep the scoring/answer-key unit invariants
green (they are the highest-value tests), and add HTTP + RBAC + flag-off coverage (§7). **Exit
criteria (must pass before release):** LEARN-INT-004, LEARN-INT-005, LEARN-UNIT-001,
LEARN-UNIT-002, LEARN-UNIT-003, LEARN-SEC-001, LEARN-SEC-002, LEARN-SEC-003, LEARN-AUTHZ-001,
LEARN-AUTHZ-003. LEARN-SEC-004 (nil-auditor) is a tracked finding — resolve or explicitly accept
the no-op audit before relying on the learn audit trail for compliance.
