# TMFA Topic Mastery — Testing Report

Date: 2026-10-25, extended 2026-10-26 · Environment: local Windows workspace with
its own Supabase Docker stack (written to, deliberately and additively — §1c, §1d).
No staging or production write, no device/emulator run.

This report lists exactly what was executed and what was not. Unit and type
checks are evidence of code correctness, **not** of live feature correctness.

---

## 1. Results summary

| Check | Command | Result |
|---|---|---|
| frontend-web typecheck | `npm run type-check` (`tsc --noEmit`) | **exit 0** (re-run 2026-10-26 after the pilot slice) |
| frontend-admin typecheck | `npm run type-check` (`tsc --noEmit`) | **exit 0** (re-run 2026-10-26 after the Pilot delivery tab) |
| Mobile typecheck | `npx tsc --noEmit` (Expo TS config) | **exit 2 — 12 errors across 6 unrelated files; 0 in `film-academy`** (re-run 2026-10-26 after the pilot labels; same unrelated set) |
| Academy unit tests | `npx vitest run tests/unit/academy` | **231 passed, 1 skipped** across 13 files (re-run after the pilot-delivery slice) |
| Full web unit suite | `npx vitest run` | **2,000 passed; 27 failed in 7 unrelated files; 2 skipped, 1 todo** — last run after the certificate slice; not re-run for the practical or pilot slices, which touched only academy code |
| New topic-mastery tests | part of the above (`topic-mastery.test.ts`) | **49 / 49 passed** (includes the 6 pilot-delivery cases in §2d) |
| New question-authoring import tests | part of the above (`topic-question-import.test.ts`) | **37 / 37 passed** |
| New certificate artifact + download tests | part of the above (`certificate-artifact.test.ts`, `certificates.test.ts`) | **19 / 19 passed** |
| New practical assessment tests | part of the above (`practical.test.ts`, `practical-admin.test.ts`) | **49 / 49 passed** |
| Web targeted lint | `npx eslint` on new routes + services + test | **exit 0, no findings** |
| Admin lint | n/a | **not available** — `frontend-admin` has no ESLint config/dependency |
| Mobile lint | n/a | **not available** — package has no lint script/config |

No test failed in the academy suite (231 passed, 1 skipped across 13 files). The
one skipped test is pre-existing in `tests/unit/academy/assessment.test.ts` and
is unrelated to this slice.

### 1a. Full web suite (last run after the certificate slice)

Not re-run for the practical slice, which changed only academy services, routes,
screens and tests. The recorded run was:

**2,030 tests in 211 files: 2,000 passed, 27 failed, 2 skipped, 1 todo.** Zero
academy tests failed. The 27 failures are in 7 untouched, unrelated files:

- 23 in `tests/unit/estate/*` (`facility-booking-conflict`, `repair-signoff`,
  `vendor-jobs-authz`, `visitor-gate-uat`), where endpoints return 423 instead of
  the expected 200/201/403/404/409.
- 4 intermittent 5-second timeouts / one cascading assertion in
  `tests/unit/voting/ad004-free-vote-rules-sync.spec.ts`,
  `tests/unit/voting/settings-contest-sync.spec.ts` and
  `tests/unit/wallet/bank.spec.ts` under 211 parallel workers. These same files
  have passed in lighter runs; the pattern was already recorded before this slice.

Neither pattern touches the academy, and neither is claimed as fixed here. The
academy suite was run separately and passed 225 / 1 skipped (§1).

### 1b. Legacy-course retirement (2026-10-25)

| Check | Result |
|---|---|
| frontend-admin `npx tsc --noEmit` | **exit 0** after removing the Curriculum/Submissions/Progress/Import/Question Bank/Exams tabs and their service methods |
| frontend-web `npx tsc --noEmit` | **exit 0** (legacy API routes untouched) |
| Mobile `npm run typecheck` | **exit 2 — 12 errors across 6 unrelated files; 0 in `film-academy`** (same unrelated set as §1) |
| Academy unit tests | **225 passed, 1 skipped** |
| Retired-route/symbol search | no live references to `/film-academy/{learn,lesson,assignments,exams}`, `lockCopy` or the removed client API functions; historical audit/inventory docs updated |
| Removed screens | `learn.tsx`, `lesson/[lessonId].tsx`, `assignments.tsx`, `exams.tsx`, `exams/[attemptId].tsx` deleted; all course entry points route to `/film-academy/path` |

### 1c. First live runs against the local dev database (2026-10-26)

First time any of this was executed against a real Postgres rather than a mocked
client. Target: the local Supabase stack (`supabase_db_spotlight`,
`127.0.0.1:54321`). Staging and production were **not** touched.

| Action | Result |
|---|---|
| `GET /api/admin/academy/topics/import` (preview) | **200** — 13 courses, 72 topics, 864 media, 336 questions, 0 rejected rows |
| `POST /api/admin/academy/topics/import` (apply) | **200** — courses 13 inserted, topics 72 inserted, media 864 inserted, questions 336 inserted, 0 locked/rejected |
| Re-apply (idempotency) | **200** — 0 inserted / 13 courses updated, 72 topics **unchanged**, 864 media refreshed, 336 questions unchanged. No duplicate rows |
| Post-import publication gates | `GET /api/admin/academy/topics` → all 72 topics `published: false` with real blockers (e.g. A01: article 101 words / 0 headings, 0 of 10 questions approved, 8 of 12 required media with no file). Import approved and published **nothing** |
| Legacy data | `academy_programs` 1, `academy_lessons` 24, `academy_enrollments` 1 — unchanged; no purge migration run |

**Defect found and fixed by these runs — silent skipped migration.**
`GET /api/academy/topics/A01/practical` returned **500**. Root cause was not the
route: `film_practical_assessments`/`film_practical_submissions` did not exist in
the database. The migration had been authored as
`20271099000002_film_academy_practical_assessments.sql`, the same 14-digit version
as `20271099000002_expand_payment_sources.sql`, and `supabase db push` keys on the
version alone — it applied the payment file, recorded the version, and skipped the
practical file without any error, exactly the failure `_reusable-migration-guard.yml`
warns about. Fix: the file was renumbered to
`20271099000004_film_academy_practical_assessments.sql` (name kept, content
unchanged and fully `IF NOT EXISTS`), applied with `psql -v ON_ERROR_STOP=1`, and
recorded with `supabase migration repair --local --status applied 20271099000004`
so the payment ledger row at `20271099000002` stays intact.

After the fix: the three queries `loadPracticalForLearner` issues all returned
**200** with `[]` through PostgREST, and the admin practical surfaces returned
**200** (`/practical` → `assessments: []`, totals all zero; `/practical/queue` →
empty; `/practical/A01` → `assessment: null`). `film_mastery_holds` gained
`source`/`source_ref` with the `manual` default; existing hold rows were untouched.

**Authenticated learner run (same day).** The route was then called as a real
enrolled learner over HTTP — a bearer token re-signed for the existing dev user's
existing `auth.sessions` row (no user, enrolment or session row was created or
modified), verified against the local GoTrue before use:

| Endpoint | Result |
|---|---|
| `GET /api/academy/topics` | **200** — courses with all 72 topics, every one `LOCKED` |
| `GET /api/academy/topics/A01` | **200** — `state: LOCKED`, `blockerCode: TOPIC_NOT_PUBLISHED`, `articleLocked: true`, 8 publication blockers |
| `GET /api/academy/topics/A01/practical` | **200** (was 500) — `assessment: null`, `submissions: []`, `eligibility.canSubmit: false`, reason "No practical assessment is set for this topic yet." |

The 500 is therefore closed at the HTTP level. What the learner screens still show
is the publication gate, not an error: `PracticalSection` deliberately renders
nothing when `assessment` is null, and no topic opens until content review and
media/question readiness pass — see `TMFA-CONTENT-READINESS.md`. Both flags were
confirmed live (the route reaches the 401/200 paths rather than returning 503).

**Still not run:** browser click-through of the admin console, a device/emulator
run of the rewired mobile entry points, a learner completing a quiz or a practical
end to end, certificate issuance, and anything at all against staging or
production. Retirement and the import are verified by typecheck, unit tests,
static reference search and the local-database probes above.

### 1d. Audited pilot delivery — applied and verified live (2026-10-26)

Purpose: exercise "the first topic opens, the rest unlock only above the 85%
threshold" with the real learner app while the curriculum is still unreviewed.
Local Supabase only; staging and production untouched.

Setup, in order:

| Step | Result |
|---|---|
| Apply `20271099000005_film_academy_pilot_unlocks.sql` | `psql -v ON_ERROR_STOP=1` → `CREATE TABLE`, 3×`COMMENT`, `CREATE INDEX`, `ALTER TABLE`, `REVOKE`, `GRANT`. RLS enabled; `anon`/`authenticated` have no access |
| Record it | `supabase migration repair --local --status applied 20271099000005` — ledger now holds `…000000`, `…000001`, `…000004`, `…000005`; `…000002` (payment) untouched. No `supabase db push` |
| `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED=true` in `.env.local` | Picked up by the running dev server; confirmed by the console state below reporting `available: true` |
| `npx vitest run tests/unit/academy` | **231 passed, 1 skipped** |
| `npx tsc --noEmit` (frontend-web, frontend-admin) | **exit 0** in both |

Admin surface:

| Call | Result |
|---|---|
| `GET /api/admin/academy/pilot` | **200** — `available: true`, `production: false`, 13 courses each with `topicCount`, `publishedCount: 0`, `entryTopicIds`, `active: false` (ACT: 24 topics, entry `A01`) |
| `POST /api/admin/academy/pilot/ACT` with `{action:"enable", note:"…"}` | **200** — `active: true`, `enabledAt` set, plus the returned notice: "Topics stay unpublished and unapproved. Learners see them labelled "Pilot delivery", and no certificate can be issued from them." |
| Audit trail | `film_academic_audit` row `FILM_PILOT_UNLOCKED` / `film_course` / `ACT` carrying the note, `before {"pilotActive": false, "publishedTopics": 0}` and `after {note, topicCount: 24, pilotActive: true, entryTopicIds: ["A01"], publishedTopicsAfter: 0}`. `actor_role` is recorded; `actor_id` is NULL for an `x-admin-key` call because that auth has no user id — a console login resolves to a uuid. Honest gap, not a missing feature. |
| Content flags after enabling | `film_topics.published` is still **0 of 72** and no question `status` changed — the pilot writes nothing but its own row and audit |

Learner surface, same re-signed bearer token as §1c (existing user, existing
`auth.sessions` row; no user/enrolment/session row created or modified):

| Call | Result |
|---|---|
| `GET /api/academy/topics` | **200** — states `{AVAILABLE: 1, LOCKED: 71}`. `A01 AVAILABLE published=false pilot=true canStartQuiz=true`; `A02–A24 LOCKED PREREQUISITE_INCOMPLETE`; `C01-T1 LOCKED TOPIC_NOT_PUBLISHED pilot=false` — the exception is scoped to ACT |
| `GET /api/academy/topics/A01` | **200** — `state: AVAILABLE`, `pilot: true`, `articleLocked: false`, article 709 characters, and still all **8 publication blockers** (`CONTENT_NOT_APPROVED`, `ARTICLE_TOO_SHORT`, `QUESTION_POOL_INSUFFICIENT`, `MANDATORY_MEDIA_NOT_READY`, …) so the exception cannot be mistaken for a reviewed lesson |
| `POST /api/academy/topics/A01/quiz` | **200** — 10 questions drawn from the unreviewed pool (`status <> 'retired'`). Payload keys per question: `attemptQuestionId, stem, points, options, objectiveId` — no `is_correct`, no `correct_answer`. The key leak check passed |
| `GET /api/academy/topics/A01/practical` | **200** — `assessment: null`, `canSubmit: false`, reason "No practical assessment is set for this topic yet." (nobody has authored one) |
| `GET /api/academy/certificate` | **200** — `topicsRequired: 72`, `topicsPublished: 0`, `eligible: false`, blockers `CURRICULUM_INCOMPLETE` + `TOPICS_INCOMPLETE`. A pilot cannot mint a credential, exactly as designed |

**Side effect to disclose:** the quiz call opened **one** `in_progress` attempt
(`6afd27a7-27a6-4ea6-8aee-0f1fda0dcd36`) for that dev learner. Nothing was
submitted, so no score, mastery row, event or hold was written; the learner will
simply resume it. No pre-existing row was modified, and nothing was deleted.

**Not verified by these runs:** the 85% pass → next-unlock step end to end on a
live database. Submitting answers requires the answer key, which the API withholds
by design, and a fabricated pass would be exactly the false evidence this project
forbids — so that transition rests on the unit cases in §2d (pilot pass ⇒
`MASTERED` ⇒ prereq satisfied) plus the unchanged gate, not on a scripted win.
Also not exercised: the `NODE_ENV=production` refusal (guard is in
`pilotDeliveryEnabled()`), the revoke call, the admin console `Pilot delivery` tab
in a browser, and any physical device.

---

## 2. New unit coverage (`frontend-web/tests/unit/academy/topic-mastery.test.ts`)

The Supabase client is mocked; these are pure-domain and plan tests.

### Exact mastery gate (7 tests)

- 8/10 fails, 9/10 passes.
- 16/20 fails, 17/20 passes.
- 84/100 fails, 85/100 passes.
- A sub-85 percentage is not rounded up into a pass.
- Non-integer, negative, over-possible and zero-possible inputs fail closed.
- The display percentage can differ from the gate without changing the verdict.
- The 85% policy and 20-item floor stay named constants.

### Publication gate (12 tests)

- A fully approved, well-formed topic publishes.
- Article approval, the ≥200-character floor and the enforced depth standard are required.
- The depth standard needs ≥1,000 words, ≥4 headings, a practical/application heading and a self-check/assessment heading.
- ≥20 approved items (or the draw count if larger) are required.
- A threshold below 85% is rejected.
- Mandatory media must be published, rights-cleared and accessibility-passed.
- A "published" asset with no file URL still blocks.
- Optional media never blocks.
- An accessible-equivalent waiver needs both the flag and a ≥20-character rationale.
- A rationale alone (no approval) does not waive media.

### Learner state machine (9 tests)

- Passed + no holds → `MASTERED`, retake blocked.
- Passed + open hold → `PASSED`, not mastered.
- In-progress attempt resumes.
- Failed attempt → remediation, retake allowed when the pool exists.
- Unpublished topic stays locked regardless of personal progress.
- Unmastered prerequisite locks the successor.
- Open hold locks the topic.
- Missing approved pool locks the topic.
- Published, prerequisite-complete topic opens.

### Certificate eligibility (7 tests)

- Issues only when every topic is published, mastered and hold-free.
- Withholds while the curriculum is incomplete/withdrawn.
- Withholds when one topic is unmastered.
- Withholds while a practical hold is open.
- Empty curriculum cannot certify.
- Negative/fractional counts cannot satisfy the gate.

### Media workflow mapping (1 test)

- Manifest notes map to explicit production states; no guessed approvals.

### Import plan (9 tests)

- Topics chain into prerequisites and every topic defaults to draft.
- Declared thresholds are raised to the 85% floor.
- Duplicate topic IDs and media pointing at unknown topics are skipped.
- A question whose answer text disagrees with its key is rejected.
- A question referencing an undeclared objective is rejected.
- Manifest review states are normalised, never auto-approved.
- The plan is deterministic for identical input.
- **The bundled pack imports as drafts only:** 13 courses / 72 topics /
  864 planned media / 336 questions; no approved or published media.
- The supplied A04 article is used; other topics keep their pack copy.

---

## 2a. Topic-targeted question import (`frontend-web/tests/unit/academy/topic-question-import.test.ts`)

Added with the authoring import slice. Supabase is mocked and the query builder
is an in-memory fake; no database is touched.

### CSV validation (15 tests)

- A complete row is accepted and the plan never leaks the key to the console.
- The source hash is SHA-256 of the raw CSV and the row count excludes the header.
- Missing columns are named; missing row fields list every absent field.
- Unknown topic and undeclared objective are rejected individually.
- Duplicate question IDs are caught case-insensitively.
- Options must be four distinct values after case/space normalisation.
- `Correct Option` must be A–D and `Correct Answer` must match that option;
  `Points` must be a positive whole number.
- A repeated stem warns but does not reject; blank objectives and published
  topics warn; the always-present "import never approves" warning is asserted.
- Quoted commas, quotes and embedded newlines survive parsing; blank rows are skipped.

### Preview (5 tests)

- Preview writes no rows, classifies approved/module-coded/other-topic items as
  blocked, and projects `required = max(20, drawCount)`, `draftAfter` and shortfall.
- An identical draft is `unchanged`; a changed draft is `update`; still no write.
- Missing headers (400 `HEADERS_MISSING`) and a header-only file (400 `NO_ROWS`)
  fail before the database is touched.
- The authoring context is served without creating an import batch.

### Commit (12 tests)

- A new item inserts as `draft` with `film_topic_id`, optional objective, null
  `film_module_code`, stage/course binding and the server-side answer key.
- Batch row is `committed: true`; counters are updated; the audit action is written.
- An identical draft is skipped as `unchanged`.
- A draft update never writes `status` and is guarded by `.eq('status','draft')`.
- Approved, module-coded and differently-assigned items are locked with distinct
  codes; nothing is written for them.
- A unique violation (`23505`) and a status change mid-import become locked rows,
  not a failed batch.
- A fully rejected file returns 422 `NO_VALID_ROWS` with no batch row; mixed files
  import the valid rows and report the invalid ones.
- The typed `TopicQuestionImportError` carries its HTTP status and code.

### Readiness CSV (5 tests)

- Header matches `TOPIC_READINESS_HEADERS` and values mirror the evaluated gate
  (depth, question counts, media, waiver, readiness, blockers).
- The required count rises above 20 with the draw count.
- Commas/quotes/newlines are quoted correctly and leading `= + - @` are prefixed
  with `'` so the export is safe to open in a spreadsheet.
- Multiple blocker codes join with `|`.

---

## 2b. Certificate PDF, QR and download (`certificate-artifact.test.ts`, `certificates.test.ts`)

Added with the certificate delivery slice. These are byte/structure and service
guard tests, not a visual or device check.

### Artifact helpers (13 tests)

- The public site origin falls back to production when unset/blank and strips
  trailing slashes; the verification path trims and percent-encodes the code.
- The download filename keeps the server-generated number and replaces unsafe
  characters; an empty result falls back to `TMFA-certificate.pdf`.
- Text is folded for the standard PDF fonts: diacritics drop, curly quotes and
  dashes become ASCII, emoji become `?`, newlines/tabs/NBSP become spaces.
- Dates render deterministically in UTC from the leading calendar date; missing
  values render "Not recorded"; unparseable values are returned unchanged.
- The QR is a real PNG at the requested 640 px width.
- The PDF starts with `%PDF-`, loads with `pdf-lib`, is exactly one A4-landscape
  page (842×595), and carries the verification URL in its keywords.
- A 400-character mixed-script name + emoji and a very long programme name do not
  throw and still produce one page.
- Null topic counts render as "Not recorded", not "0 of 0".

### Download guard (6 tests, added to `certificates.test.ts`)

- An issued credential is returned with its verification code.
- Current eligibility is **not** re-checked: a later open hold does not erase an
  already-issued credential (revocation is the only eraser).
- No credential → 404 `CERTIFICATE_NOT_FOUND`.
- Revoked → 409 `CERTIFICATE_REVOKED`.
- Non-issued status → 409 `CERTIFICATE_NOT_ISSUED`.
- Blank verification code → 409 `VERIFICATION_CODE_MISSING`.

---

## 2c. Practical assessment (`practical.test.ts`, `practical-admin.test.ts`)

Added with the practical workflow. Supabase is mocked and the query builder is an
in-memory fake (`practical-db.ts`) that supports update/insert RETURNING, upsert
with an on-conflict key, `in`, `not(... is null)`, ordering and range paging. No
database is touched.

### Learner and scoring rules (36 tests)

- The exact gate passes 85/100 and fails 84/100; a stricter 100% mark is honoured
  without rounding.
- A percentage attached by a caller to a score row is ignored; an empty rubric
  fails closed.
- Authoring: title/brief floors, an integer 85–100 pass mark, 1–10 attempts,
  explicit-boolean activation, 1–10 unique rubric criteria with normalised ids and
  integer points 1–100.
- Evidence: drafts may be empty; media links must be `http(s)`; written/link/note
  caps are enforced.
- Reviewer payload: every criterion scored exactly once, points in range,
  feedback trimmed.
- Learner state: a published topic opens; an open hold on the topic itself does
  not block its practical; a prerequisite that is passed but held does block it;
  a withdrawn assessment hides with no history but keeps graded history and
  feedback visible.
- Draft lifecycle: one draft is created, then updated without spending an attempt;
  saving after a pass, after attempts are exhausted, or while in review is refused.
- Submit: freezes the rubric and pass mark, is idempotent on replay (one row, one
  event, one audit), refuses empty evidence and refuses after a pass.
- Holds: no active assessment does nothing; one workflow hold is created and
  reused; a passed learner is not held; a passed grade clears only its hold and
  restores `MASTERED`; a manual hold prevents restoration; a failed grade converts
  the hold to `PRACTICAL_FAILED` (or inserts one) and caps `MASTERED` at `PASSED`.

### Administration rules (13 tests)

- Opening the gate backfills only quiz-passed learners who have neither a
  practical pass nor a workflow hold, opens one `PRACTICAL_PENDING` hold, caps
  `MASTERED` at `PASSED`, emits hold events and writes the audit.
- Re-saving an open assessment repairs a missing workflow hold (`unchanged` +
  `holdsOpened` reported), so a failed hold write can be retried.
- Withdrawing clears workflow holds only; a manual hold survives and keeps mastery
  at `PASSED`; earned `MASTERED` is restored.
- Re-saving a withdrawn assessment clears any leftover workflow hold.
- Grading a pass computes 100/100, clears the hold, restores `MASTERED`, and emits
  `PRACTICAL_PASSED`.
- An identical replay is reconciled without a second audit/event; a conflicting
  regrade is 409.
- A failed grade below 10 characters of feedback is 400; a valid failure records
  `PRACTICAL_FAILED` and caps mastery.
- Draft grading and a submission without a frozen rubric are refused with distinct
  409 codes.
- Grading uses the submit-time rubric even when the current assessment rubric has
  changed.
- Grading after withdrawal reports `skipped_inactive` and changes no holds.
- Queue: default submitted-only, status filters (including all), topic filter,
  learner/topic/assessment names and paging.

---

## 2d. Pilot delivery exception (`topic-mastery.test.ts`, `deriveTopicState`)

Six cases pin down that the pilot opens a sequence without weakening any rule:

- A pilot entry topic with an unreviewed pool is `AVAILABLE`.
- The same topic with an unmet prerequisite stays `LOCKED` /
  `PREREQUISITE_INCOMPLETE` — the chain is not bypassed.
- An open academic hold still wins: `LOCKED` / `HOLD_OPEN`.
- `pilotPoolReady: false` still yields `LOCKED` / `QUIZ_POOL_INSUFFICIENT`, and the
  message names the pilot rather than promising "20 approved questions".
- A passed pilot attempt resolves `MASTERED`, which is what unlocks the next topic;
  a failed one does not.
- With `pilotDelivery: false` nothing changes: `LOCKED` / `TOPIC_NOT_PUBLISHED`.

`pilotDeliveryEnabled()` is additionally guarded by `NODE_ENV === 'production'` in
code; the production branch is not exercised by a test run here (§4).

---

## 3. Other academy tests (all passing)

| File | Tests |
|---|---|
| `best-attempt.test.ts` | 5 |
| `assessment.test.ts` | 21 (1 skipped) |
| `exam-window.test.ts` | 5 |
| `revenue.test.ts` | 12 |
| `academy-mock-exams.test.ts` | 13 |
| `topic-admin.test.ts` | 12 |
| `topic-mastery.test.ts` | 49 |
| `practical.test.ts` | 36 |
| `practical-admin.test.ts` | 13 |
| `certificates.test.ts` | 11 |
| `certificate-artifact.test.ts` | 13 |
| `topic-question-import.test.ts` | 37 |

---

## 4. Not tested — explicit gaps

| Gap | Why it matters | Status |
|---|---|---|
| Migration application | Schema was never run against Postgres in this session | **Applied to the local dev DB 2026-10-26** (§1c). Topic mastery and credentials were already present; the practical migration had been silently skipped by a version collision and was renumbered and applied. `20271099000005_film_academy_pilot_unlocks.sql` applied and ledger-recorded the same day (§1d). **Never applied to staging/production** |
| Live import (preview + apply) | Idempotency and constraint behaviour against the real schema is unproven | **Proven on the local dev DB 2026-10-26** (§1c): first run inserted 13/72/864/336, second run 0 inserted / 72 unchanged, nothing approved or published. Not run elsewhere |
| Quiz E2E | Draw, timer, autosave, submit, grade, unlock on a real DB is unproven | **Partial**: on the local DB the pilot draw returned 10 unreviewed questions with no answer key in the payload (§1d). Timer, autosave, submit, grading and the live pass → next-unlock step were not run |
| Pilot delivery in production | The whole point is that it cannot fire there | `NODE_ENV=production` short-circuits `pilotDeliveryEnabled()`, and `.env.production.example` documents the flag as off — **not exercised against a real production build**. Treat as unverified until a staging build with `NODE_ENV=production` proves it |
| Practical E2E | Draft → submit → grade → hold clear/convert → mastery is fake-DB tested only; the partial unique hold index, snapshot constraints and review UI are unproven against a real database/browser | Not run |
| Practical evidence links | Only the `http(s)` scheme is validated; no file upload, malware scan, link liveness, rights check or identity/authorship verification exists | Not implemented |
| Cross-learner access tests | Service-role client bypasses RLS; code filters are the only defence | Not run |
| Concurrency tests | Two submits racing, two certificate issues racing | Not run |
| Mobile device test | Screens were typechecked, not rendered on a device/emulator. The pilot tag on the path card and the "Pilot delivery" notice on the topic screen are rendered from the `pilot` flag the API is confirmed to return (§1d), but no browser or device screenshot was taken — the automated browser session lands on `/login` and signing in as the dev learner would need its password | Not run |
| Repo-wide mobile typecheck | **Currently red:** 12 errors across 6 unrelated files — `app/(tabs)/home.tsx` (3), `app/arena/state-pride.tsx` (1), `app/association/index.tsx` (1), `app/services/airtime.tsx` (1), `app/services/electricity.tsx` (5), `src/features/featured/components/FeaturedHero.tsx` (1) — `PromoBanner` prop mismatches, an unrelated `Contact` type and the electricity transaction-type mismatch. **Zero errors reference `film-academy` or `certificate`.** These were not touched by this slice. | Pre-existing |
| Admin UI browser test | Console was typechecked, not exercised in a browser — including the new **Pilot delivery** sub-tab, whose course table, reason field and confirmation dialog are only verified through the two HTTP routes they call (§1d) | Not run |
| Practical admin UI browser test | The practical tab's authoring, backfill confirmation, queue filters and grading panel were typechecked, not exercised in a browser | Not run |
| Public verification E2E | The HTML page was rendered once on the running dev server with the flag off: **200**, correct title, `noindex, nofollow`, and the honest "not available yet" state. The JSON/QR APIs could not be probed: that pre-existing dev server returns 500 for **every** API route with `routeModule.ensureInstrumentation is not a function` (reproduced on the unrelated `/api/academy/apply`). No verified/revoked credential was exercised. | Partial |
| Certificate PDF visual review | Generation is tested at byte/structure level only; no human print/layout review and no physical-device download | Not run |
| Load/performance | No measurement of path queries, analytics counts or event polling | Not run |
| Accessibility audit | Per-asset review state is modelled; no WCAG audit was performed | Not run |
| Security review/pen test | No external review of the new surface | Not run |

Recommended first integration tests, in order:

1. Import twice → same version, no duplicate rows, no approvals. **Done on the
   local dev DB 2026-10-26 (§1c); still owed on staging/production.**
2. Start → autosave → submit twice → one mastery row, identical result.
3. 8/10 attempt → remediation; 9/10 → `PASSED`; hold → not `MASTERED`; clear
   hold → `MASTERED`; successor unlocks only then.
4. Practical on a real DB: a learner who passed the quiz before activation gets
   one `PRACTICAL_PENDING` hold and drops to `PASSED`; submit freezes the rubric;
   a failed grade needs feedback and keeps the hold; a pass clears only the
   workflow hold and restores `MASTERED`; withdrawing the assessment restores
   mastery and leaves manual holds open.
5. Learner A requests learner B's attempt/topic/practical submission/certificate
   → 403/404.
6. Publish blocked with 19 approved items and with missing media; passes at 20
   plus cleared media; waiver requires both flag and rationale.
7. Certificate blocked until all topics published/mastered/hold-free; revoke →
   public verify returns `valid: false, status: revoked`, not 404.
8. Cross-learner certificate readiness cannot leak enrollment counts.
9. Download the PDF while signed in as the holder → 200 `application/pdf`;
   anonymous → 401; another learner → 403/404; revoked → 409. Scan the embedded
   QR and confirm it opens the same credential on the public page.

---

## 5. Known risks found during implementation

- **Bundled bank cannot satisfy the 20-item gate.** The topic-aware importer can
  now bind new rows to a topic, but the content gap is unchanged: 336 supplied
  drafts, 0 approved. SME authoring/review remains required; see the content report.
- **Import writes are not one transaction.** Rows are inserted sequentially
  through PostgREST. A failure mid-file leaves earlier drafts committed and the
  batch row records the partial counts. Re-running the file is idempotent:
  `external_code` is unique, identical rows are `unchanged`, and nothing is approved.
- **Article depth is now mechanically enforced.** Submission, approval and
  publication require ≥1,000 words, ≥4 headings, a practical/application heading
  and a self-check/assessment heading. Every supplied 53–106-word brief fails;
  faculty expansion remains required before any article can be approved.
- **The depth standard is a floor, not a quality judgement.** Faculty review
  remains the authority on accuracy, pedagogy and sensitivity; the academy should
  ratify or raise the numeric floor before launch.
- **Waiver breadth.** A signed waiver bypasses mandatory-media blockers by design.
  Governance depends on the `scores:manage` signer and the audit rationale.
- **No dedicated rate limiting** on new learner endpoints beyond the platform
  middleware (which rate-limits only legacy paid-vote paths).
- **Local `npm run typecheck` runs were slow** (several minutes) but completed
  with exit 0; no incremental cache is committed.
