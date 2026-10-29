# TMFA Topic Mastery — Implementation Report

Date: 2026-10-25 · Branch: `feat/payment-method-tracking` (working tree, uncommitted)

This report separates three different claims, because they are not the same:

| Claim | Status |
|---|---|
| **Software implemented** — gates, APIs, screens, practical workflow, PDF/QR credentials | Yes, web/admin typechecks green and unit-tested; mobile repo tsc is red on unrelated files, with 0 film-academy errors |
| **Content ready for publication** | **No** — 0 of 72 topics publishable (see `TMFA-CONTENT-READINESS.md`) |
| **Live-verified** — migrations applied, import run, E2E on a real DB/device | **Local only** — the four academy migrations are applied and ledger-recorded on the local Supabase, the pack import ran there, and learner routes were exercised over authenticated HTTP (see `TMFA-TESTING-REPORT.md`). No staging/production environment has been touched, and no physical device run has been made. |

The honest one-line summary: the LMS mechanics are built and enforced in code;
the curriculum pack that would feed them is an unapproved, unproduced draft.

---

## 1. What was built

### 1.1 Persistence (additive only)

`supabase/migrations/20271099000000_film_academy_topic_mastery.sql` — ten new
tables:

| Table | Purpose |
|---|---|
| `film_curriculum_versions` | Versioned import identity (`TMFA-CURRICULUM-1.0`) |
| `film_courses` | Stable course IDs ACT, C01–C12 |
| `film_topics` | Article, outcomes, draw count, time limit, publication state, prerequisites, waiver |
| `film_topic_media` | 864 planned assets with production/rights/accessibility state |
| `film_topic_attempts` | Immutable draw snapshot, server deadline, scoped idempotency |
| `film_topic_attempt_responses` | Per-item autosave, unique per attempt/item |
| `film_topic_mastery` | Server-written mastery ledger (exact integer gate) |
| `film_mastery_holds` | Practical/safety/attendance/review holds |
| `film_mastery_events` | Append-only cursor stream for near-real-time grade delivery |
| `film_academic_audit` | Immutable academic action audit |

`supabase/migrations/20271099000001_film_academy_credentials.sql` — additive
credential columns on the pre-existing `academy_certificates`, a unique partial
index on `qr_verification_code`, and an enrollment lookup index. No existing row
is rewritten. The legacy `academy_modules`/`academy_lessons` tables and data are
preserved (no deletes), as are all K-12 Go tables.

**Legacy course retirement (learner + admin surfaces).** TMFA is now the only
Film Academy course in the product. The legacy learner screens (`learn`, `lesson`,
`assignments`, `exams`) and their client API/types were deleted, and every course
entry point — home tile, post-payment redirect, application status action, tuition
button and module tabs — now routes to `/film-academy/path`. The admin console
dropped its Curriculum, Submissions, Progress, Import, Question Bank and Exams
tabs; Course now means the TMFA `TopicsTab`. Historical enrollment, grade,
submission and certificate rows are untouched, and the legacy `/api/academy/*`
routes still exist so that data remains readable. Because the fallback course is
gone, **both feature flags must be on** for learners to have any course at all
(see §4).

`supabase/migrations/20271099000004_film_academy_practical_assessments.sql` — two
new tables: `film_practical_assessments` (one per topic, rubric JSONB, pass mark,
attempt cap, open/draft state) and `film_practical_submissions` (attempt history,
frozen rubric snapshot, server-computed score, reviewer feedback). `film_mastery_holds`
gains `source`/`source_ref` (default `manual`, so existing rows are unchanged) and
a partial unique index that permits one open practical-workflow hold per
learner/topic. No existing row is rewritten.

> **Renumbered 2026-10-26 (was `20271099000002_…`).** That version was already
> taken by `20271099000002_expand_payment_sources.sql`, and `supabase db push`
> keys on the 14-digit version alone: it applied the payment file, recorded the
> version, and skipped this one with no error. The practical tables therefore never
> existed in the local database and `GET /api/academy/topics/[topicId]/practical`
> 500ed. The file keeps its name and moves to a free version, per the rule the
> repo's own `_reusable-migration-guard.yml` states. Any environment that already
> applied the colliding version needs this migration applied — the content is
> fully `IF NOT EXISTS`, so re-running it is safe.

> **Unrelated destructive file in the tree:** `20271025001000_purge_film_academy.sql`
> is untracked, contains nine `DELETE FROM` statements and is **not** part of this
> work. It must not be applied. It was left in place for its owner.

`supabase/migrations/20271099000005_film_academy_pilot_unlocks.sql` — one new
table, `film_pilot_unlocks`: at most one row per course, holding a mandatory
≥10-character `note`, `enabled_by/enabled_at`, and `revoked_by/revoked_at` (a
pilot is active only while `revoked_at IS NULL`). RLS is enabled with the table
revoked from `anon`/`authenticated` and granted to `service_role` only, so it is
readable exclusively through the BFF. Applying it changes no existing row and sets
no publication flag. **This is a dev/staging rehearsal escape hatch, not a
publication route** — see §2.11.

### 1.2 Domain services (`frontend-web/src/server/services/academy/topics/`)

| File | Responsibility |
|---|---|
| `types.ts` | Exact 85% gate, display percent, publication verdict, media constants |
| `progress.ts` | Topic state machine, prerequisites, path summary, near-real-time event cursor |
| `quiz.ts` | Server-built quiz form, immutable snapshot, autosave, at-most-once submit, score |
| `import.ts` | Pack loader + idempotent draft import (preview/apply) |
| `question-import.ts` | Topic-targeted question CSV: validate, preview, draft-only commit, pool projection |
| `readiness.ts` | Per-topic readiness CSV export from the evaluated publication gate |
| `media.ts` | Production/rights/accessibility workflow mapping and per-asset updates |
| `admin.ts` | Admin topic list/detail, article review, publish/unpublish, holds, candidate mastery |
| `practical.ts` | Practical brief, evidence/rubric validation, frozen snapshot, server scoring, pending/failed holds, mastery restore |
| `practical-admin.ts` | Assessment authoring, gate backfill/withdrawal, review queue, snapshot grading |
| `certificates.ts` | Eligibility, issuance, revocation, public verification, download guard |
| `certificate-artifact.ts` | Server-built PDF certificate and PNG QR; font-safe text folding |
| `pilot.ts` | Dev/staging-only pilot delivery: active-unlock lookup, unreviewed pool sizing, audited enable/revoke, console state |
| `http.ts` | Shared error mapping and admin action permission split |
| `index.ts` | Public service exports |

### 1.3 API routes

All gated by `FEATURE_FILM_ACADEMY_TOPICS_ENABLED` (503 when unset). The env
examples now default it, and `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`, to true:
the legacy course is retired, so there is no fallback course.

**Learner** (Bearer + `resolveLearner`):

- `GET /api/academy/topics` — path, states, blockers, events cursor.
- `GET /api/academy/topics/[topicId]` — article, outcomes, media, holds, attempt history.
- `POST /api/academy/topics/[topicId]/quiz` — start or resume a quiz.
- `GET /api/academy/topic-attempts/[attemptId]` — replay the form and saved picks.
- `POST /api/academy/topic-attempts/[attemptId]/answer` — per-item autosave.
- `POST /api/academy/topic-attempts/[attemptId]/submit` — finalize and score.
- `POST /api/academy/learning/progress` — article completion.
- `GET /api/academy/progress/events` — cursor-polled grade/mastery events.
- `GET/PUT /api/academy/topics/[topicId]/practical` — the practical brief, rubric,
  the learner's own history/eligibility, and create/update of the one draft.
  Requires both `FEATURE_FILM_ACADEMY_TOPICS_ENABLED` and
  `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`.
- `POST /api/academy/topics/[topicId]/practical/submit` — freeze the rubric
  snapshot and hand the work to review; a replay returns the committed row.
- `GET/POST /api/academy/certificate` — readiness and self-issue.
- `GET /api/academy/certificate/pdf` — authenticated PDF download of the learner's
  own issued credential; refuses revoked/unissued records. The PDF embeds the QR.
- `GET /api/academy/certificates/verify/[identifier]` — public, PII-free JSON verification.
- `GET /api/academy/certificates/verify/[identifier]/qr` — public PNG QR, generated
  only for an identifier that resolves.
- `GET /verify/certificate/[identifier]` — public human-readable verification page
  (`noindex`), reached by scanning the PDF or mobile QR. Revoked credentials stay
  resolvable and render as revoked.

**Admin** (`assertAdminPermission`):

| Route | Permission |
|---|---|
| `GET /admin/academy/topics`, `GET /admin/academy/topics/[id]`, `GET/POST /admin/academy/topics/import` | `programs:manage` |
| `GET /admin/academy/topics/questions/import-preview`, `POST` same; `POST /admin/academy/topics/questions/import-commit` | `programs:manage` |
| `GET /admin/academy/topics/readiness` (CSV) | `programs:manage` |
| `PATCH /admin/academy/topics/[id]` | `programs:manage`, except approve/publish/unpublish/waiver → `scores:manage` |
| `GET /admin/academy/media`, `PATCH /admin/academy/media/[id]` | `programs:manage` |
| `GET /admin/academy/mastery`, `GET/POST /admin/academy/holds`, `PATCH /admin/academy/holds/[id]` | `scores:manage` |
| `GET /admin/academy/practical`, `GET /admin/academy/practical/queue`, `GET /admin/academy/practical/submissions/[id]` | `scores:manage` |
| `GET /admin/academy/practical/[topicId]` | `scores:manage` |
| `PUT /admin/academy/practical/[topicId]` (create/update, open/withdraw the gate) | `programs:manage` |
| `POST /admin/academy/practical/submissions/[id]/grade` | `scores:manage` |
| `POST /admin/academy/certificates` (issue/revoke) | `scores:manage` |
| `GET /admin/academy/pilot` (pilot console state), `POST /admin/academy/pilot/[courseId]` (enable/revoke) | `scores:manage` |

### 1.4 Learner mobile screens (Expo Router)

| Screen | Purpose |
|---|---|
| `app/film-academy/path.tsx` | Course → topic path with server-derived lock states; cursor polling; `Pilot · not yet reviewed` tag on pilot topics |
| `app/film-academy/topic/[topicId].tsx` | Article (locked until media gate is cleared), outcomes, holds, attempt history, quiz entry, practical entry card, pilot-delivery notice |
| `app/film-academy/practical/[topicId].tsx` | Practical brief and rubric, draft save, written/https-link evidence, submit, graded attempts and reviewer feedback |
| `app/film-academy/topic-attempt/[attemptId].tsx` | Server-timed quiz, per-pick autosave, submit, exact result and remediation copy |
| `app/film-academy/certificate.tsx` | Readiness blockers, earned credential, QR, copyable code, PDF download/share |
| `app/film-academy/index.tsx` | Certificate menu row added |

Supporting: `src/features/filmAcademy/topicState.ts` (shared state labels),
`useMasteryEvents.ts` (cursor polling + query invalidation, including the practical
query), certificate and practical types and API functions in `api.ts`/`types.ts`.

### 1.5 Admin console (`frontend-admin`)

`TopicsTab.tsx` adds seven sub-tabs to Film Academy:

- **Publication gates** — searchable topic list with the exact server blockers,
  article review, approve, publish/unpublish, accessible-equivalent waiver, and a
  **Download readiness CSV** export for offline faculty/SME/production work.
- **Curriculum import** — preview the exact server plan, then apply as drafts.
- **Question pool** — per-topic approved gap; topic-targeted CSV preview/commit
  (drafts only, review-locked items reported, never approved).
- **Media production** — per-asset production/rights/accessibility workflow and file URL.
- **Academic holds** — create/clear practical, safety, attendance and review holds.
- **Practical assessments** — author one assessment per topic (brief, rubric,
  pass mark, attempt cap), open/withdraw the gate with backfill counts, and review
  and grade submitted work against the frozen rubric.
- **Candidate mastery** — mastered/passed-with-hold/remediation counts and
  certificate issue/revoke/reissue.

---

## 2. Rules enforced in code

1. **Mastery:** `earned_points * 100 >= possible_points * 85`, integer-only.
   Impossibility (negative, > possible, non-integer) fails closed. The display
   percentage is never an input to the gate.
2. **Quiz security:** the draw, option shuffle, deadline and score are server-side;
   the learner receives presentation IDs and their own picks only. The answer key
   remains in `academy_question_items.answer`.
3. **At-most-once finalization:** submit is a guarded update; a replay returns the
   same result, never a second mastery write.
4. **Publication:** approved article at the enforced depth standard (≥1,000 words,
   ≥4 headings, a practical/application heading, a self-check/assessment heading)
   + ≥20 approved questions (`max(20, drawCount)`) bound by `film_topic_id` + all
   mandatory media published with cleared rights, passed accessibility and a file
   URL where required — or a signed accessible text equivalent with a
   ≥20-character rationale.
5. **Sequential unlock:** prerequisites must be `MASTERED`; locked topics return
   no article and no quiz.
6. **Holds block mastery** independently of the score; clearing the last hold
   restores `MASTERED` only if the learner passed.
7. **Credentials:** all topics published, all mastered, zero open holds,
   recomputed at issue time; revocation keeps the credential resolvable. The PDF
   route resolves ownership from the session (no client ids), refuses a revoked or
   unissued record, and renders only registry fields — never email, phone, user id
   or enrollment id. The public page is `noindex` and exposes the same fields.
8. **Fail closed:** flag off → 503; empty approved pool → no quiz start; every
   import (pack or topic questions) → draft only; topic question imports never
   approve, reassign or overwrite reviewed/module-coded items; approved-content
   edits → back to review and unpublished.
9. **Practical gate:** an active assessment blocks `MASTERED` independently of the
   quiz. The quiz finalizer opens a `PRACTICAL_PENDING` hold (`source =
   'practical_assessment'`), so a pass becomes `PASSED`, not `MASTERED`. Opening
   an assessment backfills the same hold for learners who already passed the quiz
   and caps `MASTERED` at `PASSED`; withdrawing it clears only workflow-owned holds
   and restores mastery that was already earned. Manual holds are never touched.
   Every save reconciles holds for the requested state, so a failed hold write can
   be retried by saving again; both operations are idempotent.
10. **Practical grading:** the rubric and pass mark are frozen onto the submission
    at submit; grading uses that snapshot and the same exact 85–100% integer gate,
    computed server-side from criteria. A reviewer cannot submit a percentage. A
    failed practical requires ≥10 characters of feedback. A graded result is
    replayable only with identical scores and feedback; history remains readable
    after the assessment is withdrawn.
11. **Audited pilot delivery (dev/staging only).** `pilotDeliveryEnabled()` returns
    false whenever `NODE_ENV=production`, *and* otherwise requires
    `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED` plus an active
    `film_pilot_unlocks` row for that course. A pilot substitutes for exactly two
    preconditions — `film_topics.published` and an approved question pool — and it
    substitutes by reading, never by writing: no topic gets `published`/
    `content_status` changed and no question gets its `status` changed. The draw
    filter relaxes from `status = 'approved'` to `status <> 'retired'`, and the
    learner UI marks the topic `Pilot · not yet reviewed` /
    `Pilot delivery — … cannot earn a certificate`. Everything else is unchanged:
    the prerequisite chain still requires `MASTERED` at the exact 85% gate, holds
    still block, and `certificates.ts` counts `film_topics.published`, so a fully
    completed pilot still yields `CURRICULUM_INCOMPLETE` and no credential. Enabling
    and revoking both write a `film_academic_audit` row (`FILM_PILOT_UNLOCKED` /
    `FILM_PILOT_REVOKED`, target type `film_course`) carrying the note, the actor
    role/id and before/after state; the note is required at the database level
    (`char_length(btrim(note)) >= 10`). If the unlock lookup fails, the pilot is
    treated as inactive — the failure mode is locked, never open.

---

## 3. What this implementation does NOT include

- **Binary media upload/storage for practical evidence.** A learner submits
  written work and/or an `https://` link plus a note. There is no file upload,
  storage bucket, malware scanning or link-liveness/rights check; a reviewer opens
  the external link.
- **Plagiarism/identity verification for practical work.** Grading is reviewer
  judgement against the rubric; no authorship or identity check is automated.
- **Email certificate delivery.** The PDF is generated server-side and downloadable
  from the learner app; nothing emails it. Sending mail needs a provider, a verified
  sender and a secret-management decision that is outside this slice.
- **Human/print review of the certificate layout.** The PDF is tested at byte and
  structure level (loadable, single A4-landscape page, embedded QR), not visually
  reviewed on paper or exercised on a physical device.
- **Push notifications / websockets.** Near-real-time is cursor polling of
  `film_mastery_events`; no push channel was added.
- **Offline mode, appeals/resubmission workflow, accommodations, instructor
  analytics.** Not in this slice.
- **Live application of migrations, live import, device E2E.** None were run
  (no writable environment was used). See the testing report.
- **Full WCAG audit.** Accessibility is a per-asset review state plus a signed
  text-equivalent waiver, not an automated compliance certification.
- **Any way for a pilot unlock to approve, review or publish content.** It opens a
  sequence for rehearsal only. Faculty article review, SME question approval, media
  production/rights and practical authoring remain human work that no flag,
  console control or script in this repo performs on anyone's behalf.

---

## 4. Deployment sequence (not yet performed)

1. Review and apply the four additive migrations to the target Supabase project
   (topic mastery, credentials, practical assessments, pilot unlocks). Locally, all
   four are applied and recorded in `supabase_migrations.schema_migrations`; the
   pilot table was created with `psql -v ON_ERROR_STOP=1` and booked with
   `supabase migration repair --local --status applied 20271099000005` rather than
   `supabase db push`, which would also apply unrelated pending migrations.
2. Do **not** apply `20271025001000_purge_film_academy.sql`.
3. Set `FEATURE_FILM_ACADEMY_TOPICS_ENABLED=true` and
   `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED=true` in frontend-web. Both are
   required: with the legacy course retired there is no fallback, and the course
   path plus topic quizzes/practicals live behind them. The second flag also gates
   the learner practical routes; admin authoring is available with the topics flag
   and its permissions. Neither flag publishes content — publication is still
   gated per topic server-side.
   `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED` stays **off** in production; it is
   only meaningful in dev/staging, and the service ignores it under `NODE_ENV=production`.
4. Sign in to the admin console as `programs:manage`, run **Curriculum import →
   preview**, then apply.
5. SME review: approve ≥20 items per topic (the bundled bank cannot reach this;
   see the content report). Download **Readiness CSV** to see every topic's exact
   shortfall, author new items against each topic, use **Question pool → preview →
   commit** (drafts only), then approve each item with `scores:manage`.
6. Produce media and clear rights/accessibility per asset.
7. `scores:manage` approves articles and publishes topics one by one.
8. Where the curriculum requires practical work, author each **Practical
   assessment**, keep it as a draft until reviewed, then open it. Opening backfills
   `PRACTICAL_PENDING` holds for learners who already passed the quiz. Grade
   submitted work from the review queue; a failed practical requires feedback.
9. Learners progress; `scores:manage` clears manual holds, practical passes clear
   their own workflow hold, and credentials are issued only when every topic is
   `MASTERED` and hold-free.
10. Download the certificate PDF from the learner app, scan its QR, and confirm the
   public page reports the credential as verified. Set `NEXT_PUBLIC_SITE_URL`
   (frontend-web) and `EXPO_PUBLIC_SITE_URL` (mobile) to the same public origin
   before release, or scanned codes will point at the wrong host.

Rollback is `FEATURE_FILM_ACADEMY_TOPICS_ENABLED=false` (and
`FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED=false` to withdraw practicals alone); the
additive schema can remain in place without affecting existing readers.
