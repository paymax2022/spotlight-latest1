# TMFA Topic Mastery — Implementation Report

Date: 2026-10-25 · Branch: `feat/payment-method-tracking` (working tree, uncommitted)

This report separates three different claims, because they are not the same:

| Claim | Status |
|---|---|
| **Software implemented** — gates, APIs, screens, credentials | Yes, web/admin typechecks green and unit-tested; mobile repo tsc is red on 7 unrelated files, with 0 film-academy errors |
| **Content ready for publication** | **No** — 0 of 72 topics publishable (see `TMFA-CONTENT-READINESS.md`) |
| **Live-verified** — migrations applied, import run, E2E on a real DB/device | **No** (see `TMFA-TESTING-REPORT.md`) |

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
is rewritten. The legacy `academy_modules`/`academy_lessons` pathway and all
K-12 Go tables are untouched.

> **Unrelated destructive file in the tree:** `20271025001000_purge_film_academy.sql`
> is untracked, contains nine `DELETE FROM` statements and is **not** part of this
> work. It must not be applied. It was left in place for its owner.

### 1.2 Domain services (`frontend-web/src/server/services/academy/topics/`)

| File | Responsibility |
|---|---|
| `types.ts` | Exact 85% gate, display percent, publication verdict, media constants |
| `progress.ts` | Topic state machine, prerequisites, path summary, near-real-time event cursor |
| `quiz.ts` | Server-built quiz form, immutable snapshot, autosave, at-most-once submit, score |
| `import.ts` | Pack loader + idempotent draft import (preview/apply) |
| `media.ts` | Production/rights/accessibility workflow mapping and per-asset updates |
| `admin.ts` | Admin topic list/detail, article review, publish/unpublish, holds, candidate mastery |
| `certificates.ts` | Eligibility, issuance, revocation, public verification |
| `http.ts` | Shared error mapping and admin action permission split |
| `index.ts` | Public service exports |

### 1.3 API routes

All gated by `FEATURE_FILM_ACADEMY_TOPICS_ENABLED` (default off → 503).

**Learner** (Bearer + `resolveLearner`):

- `GET /api/academy/topics` — path, states, blockers, events cursor.
- `GET /api/academy/topics/[topicId]` — article, outcomes, media, holds, attempt history.
- `POST /api/academy/topics/[topicId]/quiz` — start or resume a quiz.
- `GET /api/academy/topic-attempts/[attemptId]` — replay the form and saved picks.
- `POST /api/academy/topic-attempts/[attemptId]/answer` — per-item autosave.
- `POST /api/academy/topic-attempts/[attemptId]/submit` — finalize and score.
- `POST /api/academy/learning/progress` — article completion.
- `GET /api/academy/progress/events` — cursor-polled grade/mastery events.
- `GET/POST /api/academy/certificate` — readiness and self-issue.
- `GET /api/academy/certificates/verify/[identifier]` — public, PII-free verification.

**Admin** (`assertAdminPermission`):

| Route | Permission |
|---|---|
| `GET /admin/academy/topics`, `GET /admin/academy/topics/[id]`, `GET/POST /admin/academy/topics/import` | `programs:manage` |
| `PATCH /admin/academy/topics/[id]` | `programs:manage`, except approve/publish/unpublish/waiver → `scores:manage` |
| `GET /admin/academy/media`, `PATCH /admin/academy/media/[id]` | `programs:manage` |
| `GET /admin/academy/mastery`, `GET/POST /admin/academy/holds`, `PATCH /admin/academy/holds/[id]` | `scores:manage` |
| `POST /admin/academy/certificates` (issue/revoke) | `scores:manage` |

### 1.4 Learner mobile screens (Expo Router)

| Screen | Purpose |
|---|---|
| `app/film-academy/path.tsx` | Course → topic path with server-derived lock states; cursor polling |
| `app/film-academy/topic/[topicId].tsx` | Article (locked until media gate is cleared), outcomes, holds, attempt history, quiz entry |
| `app/film-academy/topic-attempt/[attemptId].tsx` | Server-timed quiz, per-pick autosave, submit, exact result and remediation copy |
| `app/film-academy/certificate.tsx` | Readiness blockers, earned credential, verification code |
| `app/film-academy/index.tsx` | Certificate menu row added |

Supporting: `src/features/filmAcademy/topicState.ts` (shared state labels),
`useMasteryEvents.ts` (cursor polling + query invalidation), certificate types and
API functions in `api.ts`/`types.ts`.

### 1.5 Admin console (`frontend-admin`)

`TopicsTab.tsx` adds five sub-tabs to Film Academy:

- **Publication gates** — searchable topic list with the exact server blockers,
  article review, approve, publish/unpublish, accessible-equivalent waiver.
- **Curriculum import** — preview the exact server plan, then apply as drafts.
- **Media production** — per-asset production/rights/accessibility workflow and file URL.
- **Academic holds** — create/clear practical, safety, attendance and review holds.
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
4. **Publication:** approved article (≥200 chars) + ≥20 approved questions
   (`max(20, drawCount)`) + all mandatory media published with cleared rights,
   passed accessibility and a file URL where required — or a signed accessible
   text equivalent with a ≥20-character rationale.
5. **Sequential unlock:** prerequisites must be `MASTERED`; locked topics return
   no article and no quiz.
6. **Holds block mastery** independently of the score; clearing the last hold
   restores `MASTERED` only if the learner passed.
7. **Credentials:** all topics published, all mastered, zero open holds,
   recomputed at issue time; revocation keeps the credential resolvable.
8. **Fail closed:** flag off → 503; empty approved pool → no quiz start; import →
   draft only; approved-content edits → back to review and unpublished.

---

## 3. What this implementation does NOT include

- **Practical/media submission workflow.** Holds record the outcome of practical
  work, but there is no learner upload/submission screen, rubric or instructor
  practical-grading console. Practical assessment is administered outside the app
  and recorded via holds.
- **PDF certificate generation, email delivery, QR image rendering.** The
  certificate number and verification code exist; verification is a JSON endpoint,
  not a hosted certificate PDF.
- **Push notifications / websockets.** Near-real-time is cursor polling of
  `film_mastery_events`; no push channel was added.
- **Offline mode, appeals/resubmission workflow, accommodations, instructor
  analytics.** Not in this slice.
- **Live application of migrations, live import, device E2E.** None were run
  (no writable environment was used). See the testing report.
- **Full WCAG audit.** Accessibility is a per-asset review state plus a signed
  text-equivalent waiver, not an automated compliance certification.

---

## 4. Deployment sequence (not yet performed)

1. Review and apply the two additive migrations to the target Supabase project.
2. Do **not** apply `20271025001000_purge_film_academy.sql`.
3. Set `FEATURE_FILM_ACADEMY_TOPICS_ENABLED=true` in frontend-web.
4. Sign in to the admin console as `programs:manage`, run **Curriculum import →
   preview**, then apply.
5. SME review: approve ≥20 items per topic (the bundled bank cannot reach this;
   see the content report).
6. Produce media and clear rights/accessibility per asset.
7. `scores:manage` approves articles and publishes topics one by one.
8. Learners progress; `scores:manage` clears holds and issues credentials.
9. Verify a credential through the public endpoint.

Rollback is `FEATURE_FILM_ACADEMY_TOPICS_ENABLED=false`; the additive schema can
remain in place without affecting existing readers.
