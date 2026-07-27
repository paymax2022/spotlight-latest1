# Module: Contest (STEM Platform)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** no (voting records are Supabase rows, not ledger entries — the paid-vote money path is the separate **Vote Bridge**, see `votebridge.md`) &nbsp;·&nbsp; **Feature flag:** *none* — the STEM/contest routes are mounted **unconditionally** in `NewRouter` (see finding in §6 / `CONTEST-SEC-003`)
**Code:** `backend/internal/app/router.go` (route wiring, ~L91-268); `backend/internal/handlers/stem_handler.go` (all STEM handlers + `validateStemArtifactURL`); `backend/internal/handlers/competition_handler.go` (legacy open-mic); `backend/internal/handlers/reality_tv_handler.go` (legacy reality-TV dashboard); `backend/internal/middleware/stem_authz.go` (`RequireStemRoles`), `admin_auth.go` (`RequireAdmin`), `stem_rate_limit.go` (`StemRateLimit`). Tests: `backend/internal/handlers/stem_handler_test.go`, `stem_audit_test.go`.
**Slug:** `CONTEST` (uppercase, used in Case IDs)

## 1. Overview & scope

The Contest module is the **STEM contest platform** mounted by `NewRouter` under `/api/v1/*`
(public/rate-limited) and mirrored under `/api/v1/admin/*` (admin-key + STEM-role guarded). It
manages the full contest program: schools & school profiles/teams, emerging innovators/teams/
projects, STEM contests, eligibility checks, submissions, judging (scores, rubrics, criteria,
assignments, conflict handling), voting (rules, packages, transactions), bootcamp cohorts/tasks/
scores, sponsors, awards (certificates, badges, badge-awards), and reports. Callers are the
`frontend-admin` console (via the admin mirror) and public STEM intake forms (via the `/api/v1`
group). Every sensitive mutation emits a structured audit event through the shared
`AuditService` (`WithAudit`).

**BROWNFIELD — protected legacy platform.** The legacy Spotlight contest/voting engines
(contests, voting engines, applicants, legacy auth) are **protected**: this plan tests the module
**only through observable behavior** — HTTP method/path, status code, response JSON shape, and
side effects visible through the API (e.g. a subsequent `GET` reflecting a prior write, or an
audit event). It **never** reads or asserts protected internal state directly (no DB-row
assertions against legacy tables, no reaching into engine internals), and **test setup must never
modify protected paths** — fixtures are created only through the module's own public endpoints.
Note that **multiple voting-engine generations coexist** (STEM `stem-voting` public group, its
admin mirror, the legacy open-mic `competitions` surface, the reality-TV surface, the
feature-flagged Arena engine, and the finance Vote Bridge); voting behavior must stay
**consistent across generations** — this is a standing regression risk (`CONTEST-SEC-006`).

Cross-cutting invariants are **not** repeated here — reference:
`../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md`,
`../cross-cutting/feature-flags-and-audit.md`. (Money invariants
`../cross-cutting/money-invariants.md` and `../cross-cutting/kyc-and-tiers.md` apply to the
**Vote Bridge**, not to this module — assert their **absence** here rather than assuming a gate.)

## 2. Services / endpoints in scope

Two coexisting authz generations reach the **same** `StemHandler` methods:

| Generation | Guard chain |
|---|---|
| **Public** `/api/v1/<feature>` | `StemRateLimit(n, 1m)` only — **no** admin key, **no** STEM role |
| **Admin read** `/api/v1/admin/...` | `RequireAdmin(AdminAPIKey)` → `StemRateLimit(120,1m)` → `RequireStemRoles(SUPER_ADMIN, ADMIN, OPERATIONS_MANAGER, CONTEST_MANAGER, SCHOOL_ADMIN, TEACHER_COACH, JUDGE, MENTOR, SPONSOR)` |
| **Admin manage** `/api/v1/admin/...` | `RequireAdmin(AdminAPIKey)` → `StemRateLimit(40,1m)` → `RequireStemRoles(SUPER_ADMIN, ADMIN, OPERATIONS_MANAGER, CONTEST_MANAGER)` |

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List / create schools | `GET|POST /api/v1/schools` | public (rate-limit) | no |
| School dashboard | `GET /api/v1/schools/:id/dashboard` | public (rate-limit) | no |
| School verification transition | `PATCH /api/v1/admin/schools/:id/verification` | admin-key + manage role | no |
| School profiles / teams | `GET|POST /api/v1/school-profiles`, `/school-teams` | public (rate-limit) | no |
| Emerging innovators / teams / projects | `GET|POST /api/v1/emerging-innovators`, `/emerging-teams`, `/emerging-projects` | public (rate-limit) | no |
| List / create STEM contests | `GET|POST /api/v1/stem-contests` · admin: `POST /api/v1/admin/stem-contests` | public / admin-key + manage role | no |
| Eligibility check | `POST /api/v1/stem-eligibility/check` · admin mirror | public / admin-key + manage role | no |
| Leaderboard / slices | `GET /api/v1/stem-leaderboard`, `/slices` | public (rate-limit) | no |
| Submissions list / status transition | `GET /api/v1/stem-submissions` · `PATCH /api/v1/stem-submissions/:id/status` | public (rate-limit) | no |
| Judging scores / review-state | `GET|POST /api/v1/stem-judging/scores` · `PATCH .../scores/:id/review-state` | public / admin mirror | no |
| Judging rubrics / criteria | `GET|POST .../rubrics` · `GET .../criteria` | public (rate-limit) | no |
| Judge assignments / conflict | `GET|POST .../assignments` · `PATCH .../assignments/:id/conflict` | public / admin mirror | no |
| Voting rules / packages / transactions | `GET|POST /api/v1/stem-voting/rules|packages|transactions` · admin mirror | public / admin mirror | no (Supabase rows) |
| Bootcamp cohorts / tasks / scores | `GET|POST /api/v1/stem-bootcamp/...` | public (rate-limit) | no |
| Sponsors | `GET|POST /api/v1/stem-sponsors` | public / admin mirror | no |
| Awards: certificates / badges / badge-awards | `GET|POST /api/v1/stem-awards/...` | public / admin mirror | no |
| Reports summary / buckets | `GET /api/v1/stem-reports/summary`, `/buckets` | public / admin-key + read role | no |
| Overview (admin only) | `GET /api/v1/admin/stem/overview` | admin-key + read role | no |
| Legacy open-mic (adjacent) | `GET|POST /api/v1/admin/competitions/open-mic` | admin-key (no STEM role) | no |
| Legacy reality-TV (adjacent) | `GET /api/v1/admin/reality-tv/dashboard` | admin-key (no STEM role) | no |

Behavioral notes grounded in code:
- `RequireStemRoles`: **empty** allow-list → allow all (`c.Next()`); missing `x-stem-role` → **403**
  `{"error":"missing stem role"}`; role not in set → **403** `{"error":"insufficient stem role"}`;
  match → allowed. Header is upper-cased/trimmed before comparison.
- `RequireAdmin`: when `AdminAPIKey` is empty → allow all (dev mode); otherwise `x-admin-api-key`
  must match exactly, else **401** `{"error":"unauthorized"}`.
- `StemRateLimit`: in-memory fixed window keyed by `path+method+clientIP(+role)`; over limit →
  **429** `{"error":"rate limit exceeded"}`; sets `X-RateLimit-*` headers.
- `validateStemArtifactURL`: uploaded-artifact URLs must be `http(s)` with an allow-listed
  extension per kind (image/document/deck/video/id_doc); empty is allowed; bad ext/scheme → 400.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Create-school required-field / artifact-URL validation | con | `stem_handler_test.go` (`TestCreateSchool_Validation`, `TestCreateSchool_InvalidArtifactURL`) | AUTOMATED |
| School-profile required fields | con | `stem_handler_test.go` (`TestCreateSchoolProfile_Validation`) | AUTOMATED |
| Contest required fields (name+slug) | con | `stem_handler_test.go` (`TestCreateContest_Validation`) | AUTOMATED |
| Eligibility required fields | con | `stem_handler_test.go` (`TestCheckEligibility_Validation`) | AUTOMATED |
| Submission status required | con | `stem_handler_test.go` (`TestUpdateSubmissionStatus_Validation`) | AUTOMATED |
| Judging-score / rubric / criteria required | con | `stem_handler_test.go` (`TestCreateJudgingScore_Validation`, `TestCreateJudgingRubric_Validation`, `TestJudgingScores_Validation`, `TestJudgingCriteria_Validation`) | AUTOMATED |
| Leaderboard-slices required contestId | con | `stem_handler_test.go` (`TestLeaderboardSlices_Validation`) | AUTOMATED |
| Emerging-innovator artifact-URL validation | con | `stem_handler_test.go` (`TestCreateEmergingInnovator_InvalidArtifactURL`) | AUTOMATED |
| Judge-assignment status enum + required fields | con/fsm | `stem_handler_test.go` (`TestCreateJudgeAssignment_Validation`, `TestCreateJudgeAssignment_InvalidStatus`) | AUTOMATED |
| Judging review-state enum + locked-needs-reason | con/fsm | `stem_handler_test.go` (`TestUpdateJudgingScoreReviewState_Validation`, `TestUpdateJudgingScoreReviewState_LockedWithoutReason`) | AUTOMATED |
| Assignment conflict transition guards | fsm | `stem_handler_test.go` (`TestUpdateJudgeAssignmentConflict_Validation`) | AUTOMATED |
| Sensitive mutations emit audit event (action+severity+module=stem) | int/sec | `stem_audit_test.go` (`TestStemMutationsEmitAudit`) | AUTOMATED |
| Nil audit sink is a safe no-op | int | `stem_audit_test.go` (`TestStemMutationNilAuditSafe`) | AUTOMATED |
| STEM-role guard: missing / wrong / correct role | authz | — | TODO |
| Admin-key guard on admin mirror | authz | — | TODO |
| Public generation reaches mutations without any guard | sec | — | TODO |
| IDOR — role guard is not object-level | authz/sec | — | TODO |
| Voting consistency across engine generations | int/e2e | — | TODO |
| Rate-limit 429 | sec | — | TODO |
| Contest lifecycle happy path (create→judge→award) | e2e | — | TODO |
| Flag-off / route-mount posture | sec | — | TODO (module has no flag — see §6) |

## 4. Manual test cases

All cases assert **observable behavior only** (status code, response JSON, and effects visible on
a subsequent API read/audit). Fixtures are created through the module's own endpoints — never by
writing legacy/protected tables. "admin-key" = valid `x-admin-api-key`; "manage role" ∈
{SUPER_ADMIN, ADMIN, OPERATIONS_MANAGER, CONTEST_MANAGER}; "read-only role" ∈ {JUDGE, MENTOR,
SPONSOR, SCHOOL_ADMIN, TEACHER_COACH}.

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CONTEST-INT-001` | Create school (public happy path) | P1 | routes mounted | `POST /api/v1/schools` | `{"schoolName":"Acme High","state":"Lagos"}` | 201 `{success:true,school:{...}}`; audit `stem.school.create` sev=medium |
| `CONTEST-INT-002` | Create contest via admin manage | P0 | admin-key + manage role | `POST /api/v1/admin/stem-contests` with `x-admin-api-key` + `x-stem-role:CONTEST_MANAGER` | `{"name":"Robotics","slug":"robotics","status":"draft"}` | 201 `{success:true,contest:{...}}`; audit `stem.contest.create` sev=high |
| `CONTEST-INT-003` | Record a vote transaction | P0 | contest exists | `POST /api/v1/stem-voting/transactions` | `{"contestId":"c1","voterRef":"v1"}` | 201 `{success:true,transaction:{...}}`; audit `stem.voting.transaction.create` sev=high; later `GET .../transactions?contestId=c1` reflects it |
| `CONTEST-INT-004` | Leaderboard read reflects standings | P1 | contest with votes | `GET /api/v1/stem-leaderboard?contestId=c1` | contestId=c1 | 200 `{success:true,leaderboard:[...]}` with rank/rankChange projection fields |
| `CONTEST-INT-005` | Eligibility check returns decision | P1 | contest exists | `POST /api/v1/stem-eligibility/check` | `{"contestId":"c1","participantType":"SCHOOL_TEAM","state":"Lagos","schoolLevel":"SS","schoolVerified":true}` | 200 `{success:true,result:{...}}` (eligible/ineligible per rules) |
| `CONTEST-INT-006` | School verification transition | P1 | school exists; admin-key + manage role | `PATCH /api/v1/admin/schools/s1/verification` | `{"status":"APPROVED","reason":"ok"}` | 200 `{success:true,id:"s1",status:"APPROVED"}`; audit `stem.school.verification` sev=high |
| `CONTEST-CON-001` | Create school missing schoolName | P1 | — | `POST /api/v1/schools` | `{"state":"Lagos"}` | 400 `school name is required`; nothing created |
| `CONTEST-CON-002` | Create contest missing name/slug | P0 | — | `POST /api/v1/stem-contests` | `{"name":"My Contest"}` | 400 `name and slug are required` |
| `CONTEST-CON-003` | Reject disallowed artifact URL extension | P1 | — | `POST /api/v1/emerging-innovators` | `{"fullName":"Jane","email":"j@x.com","videoDemoUrl":"https://cdn/x.exe"}` | 400 `invalid videoDemoUrl` |
| `CONTEST-CON-004` | Eligibility missing required fields | P1 | — | `POST /api/v1/stem-eligibility/check` | `{"participantType":"SCHOOL_TEAM"}` | 400 `contestId and participantType are required` |
| `CONTEST-CON-005` | Leaderboard missing contestId | P2 | — | `GET /api/v1/stem-leaderboard` | (no query) | 400 `contestId is required` |
| `CONTEST-CON-006` | Vote transaction missing contestId/voterRef | P1 | — | `POST /api/v1/stem-voting/transactions` | `{"contestId":"c1"}` | 400 `contestId and voterRef are required` |
| `CONTEST-CON-007` | Invalid school verification status enum | P1 | admin-key + manage role | `PATCH /api/v1/admin/schools/s1/verification` | `{"status":"BOGUS"}` | 400 `invalid verification status` |
| `CONTEST-CON-008` | Judge-assignment invalid status enum | P1 | admin-key + manage role | `POST /api/v1/admin/stem-judging/assignments` | `{"contestId":"c1","applicationId":"a1","judgeUserId":"j1","status":"unknown"}` | 400 `invalid assignment status` |
| `CONTEST-AUTHZ-001` | Admin mirror missing admin key | P0 | `AdminAPIKey` set | `POST /api/v1/admin/stem-contests` **without** `x-admin-api-key` | manage body | 401 `unauthorized`; nothing created (guard runs before role check) |
| `CONTEST-AUTHZ-002` | Admin mirror missing `x-stem-role` | P0 | admin-key present | `POST /api/v1/admin/stem-contests` with key, **no** `x-stem-role` | manage body | 403 `missing stem role` |
| `CONTEST-AUTHZ-003` | Admin manage with wrong (read-only) role | P0 | admin-key present | `POST /api/v1/admin/stem-contests` with `x-stem-role:JUDGE` | manage body | 403 `insufficient stem role` (JUDGE not in manage set) |
| `CONTEST-AUTHZ-004` | Admin manage with correct role allowed | P0 | admin-key present | `POST /api/v1/admin/stem-contests` with `x-stem-role:CONTEST_MANAGER` | valid body | 201 created |
| `CONTEST-AUTHZ-005` | Role-tier split: JUDGE reads but cannot manage | P1 | admin-key present | `GET /api/v1/admin/stem-judging/scores?applicationId=a1` (JUDGE) then `POST .../scores` (JUDGE) | `x-stem-role:JUDGE` | GET 200 (read set includes JUDGE); POST 403 `insufficient stem role` |
| `CONTEST-AUTHZ-006` | IDOR — guard is role-level, not object-level | P0 | admin-key present; two judges' assignments exist | judge-B (`x-stem-role:JUDGE`... via manage-eligible role for write) `PATCH /api/v1/admin/stem-judging/assignments/{assignmentOwnedByJudgeA}/conflict` | valid conflict body | Request is **accepted** on any id — no ownership scoping. Document as a **finding**: object-level authz is absent; a role-holder can mutate another party's judging object |
| `CONTEST-FSM-001` | Verification enum accepts any→any (no graph) | P1 | school APPROVED; admin-key + manage role | `PATCH .../schools/s1/verification` `{"status":"PENDING"}` then `{"status":"SUSPENDED"}` | valid enums | Both 200 — handler validates the enum only, **not** a transition graph. Document: no illegal-transition rejection |
| `CONTEST-FSM-002` | Locked review-state requires isLocked+lockReason | P1 | admin-key + manage role | `PATCH .../stem-judging/scores/sc1/review-state` `{"reviewStatus":"locked","isLocked":true}` (no reason) | — | 400 `lockReason is required when isLocked is true` |
| `CONTEST-FSM-003` | Conflict flag requires reason + valid status | P1 | admin-key + manage role | `PATCH .../stem-judging/assignments/as1/conflict` `{"hasConflict":true}` | — | 400 `conflictReason is required when hasConflict is true` |
| `CONTEST-FSM-004` | hasConflict=false cannot stay flagged_conflict | P2 | admin-key + manage role | `PATCH .../conflict` `{"hasConflict":false,"status":"flagged_conflict"}` | — | 400 `cannot keep flagged_conflict status when hasConflict is false` |
| `CONTEST-FSM-005` | Submission status accepts arbitrary string | P2 | submission exists | `PATCH /api/v1/stem-submissions/sub1/status` `{"status":"anything"}` | free-form | 200 accepted — no enum whitelist on submission status (unlike verification/review-state). Document as a validation-gap finding |
| `CONTEST-SEC-001` | Public generation reaches mutations unguarded | P0 | routes mounted | `POST /api/v1/stem-contests` and `POST /api/v1/stem-voting/transactions` with **no** admin key and **no** `x-stem-role` | valid bodies | 201 created — public group carries **only** the rate limiter. Document as the **primary security finding**: high-impact contest/vote mutations are publicly writable, while the identical admin mirror is guarded (dual-generation authz divergence) |
| `CONTEST-SEC-002` | Rate limit returns 429 | P2 | — | Exceed the per-route window (e.g. >20/min on `POST /api/v1/stem-contests`) | burst | 429 `rate limit exceeded`; `X-RateLimit-*` headers present; never 500 |
| `CONTEST-SEC-003` | Flag-off / mount posture | P0 | n/a | Attempt to disable the module via any `FEATURE_*` flag, then call a STEM route | valid | Route **stays mounted** — the STEM/contest platform has **no feature flag** (mounted unconditionally in `NewRouter`), unlike `FEATURE_ARENA_ENABLED`. This **deviates from** `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001; flag as a finding and recommend a kill-switch flag |
| `CONTEST-SEC-004` | Injection payloads stored, never 500 | P1 | — | Create school/contest with `<script>`/SQL-meta in free-text fields | `schoolName:"<script>alert(1)</script>"` | 201; value round-trips verbatim via parameterized Supabase writes; no 500, no server-side execution (rendering safety is a frontend concern) |
| `CONTEST-SEC-005` | Sensitive mutations audited | P0 | audit sink wired | Perform each guarded mutation | valid bodies | Exactly one audit event per mutation with `module=stem`, expected action + severity (see `stem_audit_test.go`; `../cross-cutting/feature-flags-and-audit.md`) |
| `CONTEST-SEC-006` | Voting consistency across engine generations | P0 | contest c1 | Record the same logical vote via public `POST /api/v1/stem-voting/transactions` and via admin mirror `POST /api/v1/admin/stem-voting/transactions`; observe `GET .../transactions` and leaderboard | identical `{contestId,voterRef}` | Both generations hit the **same** handler and produce a consistent recorded transaction + leaderboard effect; only the **guard chain** differs. **Regression risk**: divergence between generations (or vs Arena / open-mic / Vote Bridge) must be caught — observable outputs must agree |
| `CONTEST-E2E-001` | Contest lifecycle end-to-end (observable) | P1 | admin-key + manage role | create contest → check eligibility → advance submission status → upsert judging score → create judge assignment → read leaderboard → award badge | chained ids from each response | Each step returns its 2xx + audit event; final `GET` reads (leaderboard, badge-awards) reflect the chain — entirely via the public API, no protected-state reads |

## 5. State-machine transitions

The module exposes several **field-level enum guards** but does **not** enforce a transition
graph — validation is on the *target* value, not the *from→to* edge. Assert both the accepted
enums and the absence of illegal-transition rejection (flag the latter as a finding).

| Domain | From | Event | To | Guard / side effect | Case ID |
|---|---|---|---|---|---|
| School verification | any | `PATCH /schools/:id/verification` | PENDING / UNDER_REVIEW / APPROVED / REJECTED / SUSPENDED / NEEDS_MORE_INFORMATION | target must be a valid enum; **any→any accepted** (no graph); audit `stem.school.verification` | `CONTEST-FSM-001` |
| Judging review-state | any | `PATCH /stem-judging/scores/:id/review-state` | submitted / in_review / locked / reopened / approved / rejected / conflict_hold | `locked` requires `isLocked=true`; `isLocked=true` requires `lockReason`; audit `stem.judging.score.review_state` | `CONTEST-FSM-002` |
| Judge assignment | assigned | `PATCH /stem-judging/assignments/:id/conflict` (hasConflict=true) | flagged_conflict / recused | requires `conflictReason`; other target statuses rejected | `CONTEST-FSM-003` |
| Judge assignment | flagged_conflict | `PATCH .../conflict` (hasConflict=false) | resolved / reassigned / recused | may **not** remain `flagged_conflict` | `CONTEST-FSM-004` |
| Submission | any | `PATCH /stem-submissions/:id/status` | *(any non-empty string)* | **no enum whitelist** — only `status != ""` enforced | `CONTEST-FSM-005` |
| Contest stages | — | `POST /stem-contests` | `StageLifecycle[]` + `StageTransitions{}` stored as data | transition graph is **stored, not enforced** by the handler | *(finding — see §6)* |

Illegal transitions to assert are rejected: locked-without-reason (`CONTEST-FSM-002`),
conflict-without-reason (`CONTEST-FSM-003`), false-conflict-still-flagged (`CONTEST-FSM-004`),
invalid assignment status (`CONTEST-CON-008`), invalid verification status (`CONTEST-CON-007`).
Re-applying a terminal enum (e.g. verification `APPROVED`→`APPROVED`) is accepted and idempotent
in observable effect.

## 6. Security & abuse cases

- **Dual-generation authz divergence (primary finding)** — `CONTEST-SEC-001`: the public
  `/api/v1/<feature>` group carries **only** `StemRateLimit`, so high-impact mutations
  (`CreateContest`, `CreateVoteTransaction`, `UpdateSubmissionStatus`, `AwardBadge`, etc.) are
  publicly writable, while the byte-identical `/api/v1/admin/...` mirror requires admin-key +
  STEM role. Report this as the top risk.
- **STEM-role guard** — `CONTEST-AUTHZ-002/003/004`: missing header → 403 `missing stem role`;
  wrong role → 403 `insufficient stem role`; correct role → allowed. Note `RequireStemRoles`
  with an **empty** allow-list is a pass-through (`c.Next()`) — the router always passes a
  non-empty list, but a future refactor to an empty list would silently disable the guard
  (regression watch). See `../cross-cutting/rbac-and-permissions.md`.
- **Admin-key guard** — `CONTEST-AUTHZ-001`: `RequireAdmin` runs **before** the role check;
  empty `AdminAPIKey` = dev-mode allow-all (do not run this suite against a server with an unset
  key — it would mask both guards). See `../cross-cutting/authentication.md`.
- **IDOR / object-level authz absent** — `CONTEST-AUTHZ-006`: guards are role-level only; no
  handler scopes `:id` to the caller (a judge/school can act on another's object). Finding.
- **No feature-flag kill-switch** — `CONTEST-SEC-003`: deviates from FLAG-SEC-001
  (`../cross-cutting/feature-flags-and-audit.md`); the module cannot be disabled by flag.
- **Rate-limit abuse** — `CONTEST-SEC-002`: 429 on window breach; in-memory store is
  per-process (not shared across instances) — note as a horizontal-scaling limitation.
- **Injection** — `CONTEST-SEC-004`: free-text fields persist verbatim via parameterized
  Supabase writes; assert no 500 and no server-side execution.
- **Audit trail** — `CONTEST-SEC-005`: every sensitive mutation emits `module=stem` events (see
  `stem_audit_test.go`); the nil-sink no-op path must not panic.
- **Not a money path** — voting rows here are **not** ledger entries; do **not** expect
  `Idempotency-Key`, double-entry, or tier/KYC gates on these endpoints. The paid-vote money
  path is the separate **Vote Bridge** (`votebridge.md`); assert the absence of money gates here
  rather than testing for them.
- **Brownfield boundary** — never assert against protected legacy tables/engine internals;
  exercise only the module's own observable API, and never mutate protected paths in setup.
- **Cross-generation voting regression** — `CONTEST-SEC-006`: outputs of the STEM public/admin
  generations must agree; extend to compare against Arena and open-mic where they overlap.

## 7. Automated specs to add

- `backend/internal/handlers/stem_authz_test.go` — table-driven httptest over
  `RequireStemRoles`: missing header → 403 `missing stem role`; unknown role → 403 `insufficient
  stem role`; each manage/read role → allowed/denied per set; empty allow-list → pass-through.
  Follows the existing hand-rolled `gin.New()` + `httptest` convention in `stem_handler_test.go`.
- `backend/internal/handlers/stem_admin_guard_test.go` — assert `RequireAdmin` precedes
  `RequireStemRoles` (missing key → 401 even with a valid role) and empty-key dev bypass.
- `backend/tests/contest_public_vs_admin_authz_test.go` — mount the real router
  (`app.NewRouter`) and assert the **public** generation reaches mutations unguarded while the
  admin mirror enforces key+role, pinning `CONTEST-SEC-001` as a regression guard until fixed.
- `backend/tests/contest_voting_consistency_test.go` — record equivalent votes through the
  public and admin voting endpoints and assert consistent transaction/leaderboard output
  (`CONTEST-SEC-006`), gated on `TEST_DATABASE_URL`.
- `backend/internal/handlers/stem_submission_status_enum_test.go` — after adding a whitelist,
  assert `UpdateSubmissionStatus` rejects unknown statuses (closes `CONTEST-FSM-005`).

Mark each TODO in the §3 matrix as it lands.

## 8. Coverage target & exit criteria

Tier-1 module: ≥ 70% on `stem_handler.go` validation/enum branches + the three guard
middlewares. **Exit criteria (all must pass before release):** `CONTEST-INT-002`,
`CONTEST-INT-003`, `CONTEST-AUTHZ-001`, `CONTEST-AUTHZ-002`, `CONTEST-AUTHZ-003`,
`CONTEST-AUTHZ-004`, `CONTEST-SEC-005`, `CONTEST-SEC-006`. The findings `CONTEST-SEC-001`
(public unguarded mutations), `CONTEST-SEC-003` (no kill-switch flag), and `CONTEST-AUTHZ-006`
(no object-level authz) are **triage blockers** — each must be either fixed or explicitly
risk-accepted (with an owner) before the module ships.
