# TMFA 85% mastery — release-gate conformance (GATE-001 … GATE-016)

Source: `TMFA_85_PERCENT_MASTERY_AND_IMPORT_SPEC.md` §6 (curriculum pack).
Audited against `main` at the merge of PR #900 (2026-10-25). The Film LMS is the
Next.js server in `frontend-web` (`app/api/academy/*`,
`src/server/services/academy/*`), the React Native learner app
(`mobile-app/reactnative/app/film-academy`) and the admin console
(`frontend-admin/app/admin/academy/film`).

Status key: **Covered** = implemented and a test proves it. **Partial** = some of
the behaviour exists or is tested. **Not covered** = not implemented.
"In flight" means work that was open when this was written: the importer
(rationale required, drafts only, TMFA CSV format), the curriculum seed (72
topics, unpublished, checkpoint 85% / draw 10) and gate hardening (lesson-progress
`MODULE_LOCKED`, per-topic ≥20 approved items before publish).

Test files: MG = `frontend-web/tests/unit/academy/module-gate.test.ts`,
GC = `frontend-web/tests/unit/academy/gate-conformance.test.ts`,
AS = `frontend-web/tests/unit/academy/assessment.test.ts`,
BA = `frontend-web/tests/unit/academy/best-attempt.test.ts`,
GL = `frontend-web/tests/unit/golden-path/academy-learning.spec.ts`,
RN = `mobile-app/reactnative/tests/unit/filmAcademy/moduleGate.spec.ts`.

| Gate | Requirement | Status | Evidence | Gaps / in flight |
|---|---|---|---|---|
| GATE-001 | 8/10 → next module locked; remediation offered | Partial | MG `'%i/%i at 85'` (8/10 false), `locks the next module after 8/10…`, `refuses module 2 quiz when module 1 quiz scored 8/10`. Locked lessons served as outlines only (`app/api/academy/learning/route.ts`). | Lock is covered. No remediation flow exists (result screen says only "a tutor can tell you what happens next"). |
| GATE-002 | 9/10 → unlocked exactly once | Covered | MG (9/10 true), `allows module 2 quiz once module 1 quiz scored 9/10`; GC `a lower retake after a 9/10 pass does not re-lock`; BA `keeps the pass when a later retake scores lower`. | Unlock is derived from the best graded attempt on every read; there is no unlock event/ledger row, so "once" holds by construction. |
| GATE-003 | 17/20 passes at exactly 85% | Covered | MG (17/20 true); `moduleGate.ts` `earned*100 >= possible*passMark`. | — |
| GATE-004 | 16/20 or 84.999% stays locked; no UI round-up | Covered | MG (16/20 false), `fails 84.999…%…`, `a just-under-85 attempt is not passed`, `does not unlock on a rounded-up stored percentage`; RN `displayed percent is rounded DOWN from points`. | `/api/academy/learning` still sends `scorePercent: Math.round(percentage)`; the app now ignores it when points are present. |
| GATE-005 | Client-sent `correct_option` / `passed=true` ignored | Covered | GC `saving an answer forwards only the question and presentation ids`, `submitting ignores any score or verdict in the body`; AS `an invalid presentation id earns nothing`, `presents a shuffled order, exposes NO correct answer…`. | — |
| GATE-006 | Concurrent resubmit → one result, one ledger event | Partial | `submitAttempt` finalises with a conditional update on `attempt_state='in_progress'` and re-reads the stored receipt on a lost race; start is unique on `(enrollment_id, exam_id, idempotency_key)`. | No test (needs a DB-backed concurrency test). No mastery-ledger or audit event is written on finalisation. |
| GATE-007 | Pass while safety hold open → not advanceable | Not covered | No hold concept in academy services, routes or migrations. | Not in any in-flight work. |
| GATE-008 | Pass quizzes, fail practical → no stage completion/graduation | Not covered | Practicals/assignments are graded, but nothing gates stage completion or graduation on them. | Not in any in-flight work. |
| GATE-009 | Import duplicate ID / empty rationale / bad option → rejected, no partial production publish | Partial | AS `rejects a blank / duplicate Question ID`, `rejects a Correct Option that is not A-D`, `rejects when Answer Text disagrees…`, `warns — never blocks — when a non-draft status is imported`, `keeps a partially-valid batch…`. Commit writes rows as `draft` only. | Empty rationale is not rejected today — **in flight: importer** (rationale required, drafts only, TMFA CSV format). Good rows of a mixed batch are committed as drafts (never published). |
| GATE-010 | Retake after version bump → pinned attempt; new attempts use reviewed version | Partial | Attempt `item_snapshot` pins stem/options/option map. | No test. The answer key is re-read at submit by item id; approved items are frozen in app code, not by a DB rule. No question versioning. |
| GATE-011 | Tampered offline/sync flag → no automatic mastery | Covered | GC `only a graded quiz attempt opens a module`, `an in-progress attempt, or one the client calls passed, does not unlock`; GL `records progress against the session enrolment…`. | Lesson completion on a locked module is still accepted — **in flight: gate hardening** (progress `MODULE_LOCKED`). The app already handles that refusal. |
| GATE-012 | Grade change without permission → rejected and audited | Partial | GC `refuses with 403 and writes nothing when the permission check fails`; GL grading bounds tests. | No audit event on a grade, regrade or denied attempt (only `reviewed_by`). |
| GATE-013 | Missing captions / asset clearance → mandatory lesson publish blocked | Not covered | No caption or rights fields or checks on lessons. | Not in any in-flight work. |
| GATE-014 | Screen-reader learner has an equivalent path | Partial | Lock state is conveyed in text with accessibility labels; exam options expose `radio` role and checked state (this PR). | No transcripts or text alternatives for lesson video; no automated a11y test. |
| GATE-015 | Team capstone missing individual contribution → certificate held | Not covered | Film LMS has no certificates or capstone contribution tracking. | — |
| GATE-016 | Guessed certificate URL → only public verification metadata | Not covered | Film LMS has no certificates. (The separate Go academy credentials module returns a reduced `PublicVerification`, untested, on a member-only route.) | — |

Publish preflight (spec §1.4, ≥20 approved items per topic) is not a numbered
gate; it is **in flight: gate hardening**. The admin Exams tab now shows a refused
publish inline and in full, so a message listing several short topics is readable.
