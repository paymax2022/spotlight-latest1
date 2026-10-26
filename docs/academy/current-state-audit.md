# Film Academy — Current-State Audit (PRD BK-00)

> Mandatory first milestone of the *Timeless Movies Film Academy Brownfield Upgrade*
> PRD (§2, line 99): "Do not begin schema or login refactoring before this milestone
> is documented." This document is the current-state architecture diagram, API
> inventory, migration compatibility matrix, and smoke-test baseline the milestone
> requires. It describes the system **as it exists**, distinguishing the shipped
> assessment slice from the broader PRD ambition. Every claim cites a real path.
>
> Audit date: 2026-10-21 · Auditor slice: question bank + SME review + server-scored
> exams (PRD BK-06/07 + BK-10).
>
> **Superseded in part (2026-10-25):** the legacy modules/lessons course and the
> admin Import/Question Bank/Exams tabs described here have been retired from the
> learner app and console; TMFA is now the only course. This audit is retained as
> the historical baseline. See TMFA-IMPLEMENTATION-REPORT.md §1.1 for the
> retirement scope and what was preserved.

---

## 0. The single most important fact: two academies, one database

The PRD reads as if "Academy" is one system. It is not. The repository contains
**two distinct academy implementations that share the same PostgreSQL database and,
deliberately, one question-bank table**:

| | K-12 "Spotlight Academy" | Timeless Movies "Film Academy" |
|---|---|---|
| Backend | **Go** service, `backend/internal/academy/*` (23 sub-packages) | **frontend-web** Next.js route handlers → Supabase |
| Router / DB access | gin v1.12.0, `pgx/v5` pool | `@supabase/ssr` + service-role client |
| Data path | `backend/internal/app/academy_routes.go` → `/api/finance/academy/*` | `frontend-web/app/api/academy/*`, `…/admin/academy/*` |
| Auth | Go middleware + `academyplatform` DB-backed flags | `requireRequestUser` (Bearer) / `assertAdminPermission` |
| Question bank | reads `academy_question_items` where `academy_scope IS NULL` (NERDC) | reads `academy_question_items` where `academy_scope = 'film'` |

**Evidence that the Film Academy assessment plane has no Go backend:**
`grep academy_exam_attempts backend/internal/` → **zero hits**; the new tables
(`academy_exam_attempt_responses`, `academy_question_reviews`,
`academy_question_import_batches`) are referenced only from
`frontend-web/src/server/services/academy/assessment/*`. The Go engine does not
know these tables exist.

**Consequence for the brownfield upgrade:** the assessment slice *extends a
frontend-web-owned surface that reads tables originally created by the K-12
engine*. This is the compatibility risk the rest of this document fences in. It
also matches the console's own note that "Film Academy has no Go module… so this
goes through `/api/web-proxy`" (`frontend-admin/src/services/filmAcademyAdminService.ts`,
header + ADR-047).

---

## 1. Monorepo layout, source control, CI

Three-app monorepo plus a Go backend and shared migrations, all in one repo:

```
backend/                 Go service (gin) — most modules, incl. K-12 academy
frontend-web/            Next.js — learner API + BFF + learner pages (Film Academy home)
frontend-admin/          Next.js — operations console (admin persona)
mobile-app/reactnative/  Expo — learner app
supabase/migrations/     649 migrations (61 academy-prefixed) — the single shared DB schema
docs/adr/                ADR ledger (ADR-000 template … ADR-060), enforced by adr-guard.yml
```

- **Default branch** `origin/main`; long-lived `develop` and `staging` exist
  (`origin/HEAD -> origin/main`).
- **Code owners:** `.github/CODEOWNERS` is present.
- **CI** (`.github/workflows/`) already runs the gates this slice touches:
  `_reusable-frontend-web.yml`, `_reusable-go-verify.yml`,
  `_reusable-node-typecheck.yml`, **`_reusable-migration-guard.yml`**,
  `adr-guard.yml` / `adr-assign.yml`, `mobile-eas.yml`, `security.yml`.
- **Migration iron rule** (enforced by `_reusable-migration-guard.yml`, quoting
  CLAUDE.md): *"All DB migrations are additive-only: no DROP, no column renames,
  no type narrowing."* The guard scans only migrations **added in the PR**, and
  allows idempotent re-create patterns (`DROP INDEX IF EXISTS`,
  `CREATE OR REPLACE`) while rejecting `DROP TABLE|COLUMN|TYPE` and `ALTER … DROP`.

---

## 2. Current-state architecture (assessment slice)

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│ mobile-app/reactnative  │        │       frontend-admin          │
│  learner exams UI       │        │  film/page.tsx Import/Bank/   │
│  film-academy/exams*    │        │  Exams tabs                   │
└───────────┬─────────────┘        └───────────────┬───────────────┘
            │ axios EXPO_PUBLIC_API_BASE_URL        │ webProxyBase() → /api/web-proxy
            ▼                                       ▼ (admin key or Supabase JWT)
┌──────────────────────────────────────────────────────────────────┐
│  frontend-web  (Next.js App Router — the Film Academy BFF)         │
│  app/api/academy/*            learner: exams · attempt · answer ·  │
│                               submit  (Bearer → requireRequestUser)│
│  app/api/admin/academy/*      admin: questions · review · exams ·  │
│                               publish     (assertAdminPermission)  │
│  src/server/services/academy/assessment/  csv·bank·scoring·attempts│
│  featureFlags.filmAcademyAssessment()  → 503 when OFF              │
└───────────────────────────────┬──────────────────────────────────┘
                                 │ createAdminClient() = SUPABASE_SERVICE_ROLE_KEY
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Supabase PostgreSQL (shared with the Go K-12 academy)             │
│  academy_question_items (scope='film' | NULL) · academy_exams      │
│  academy_exam_attempts · academy_exam_attempt_responses            │
│  academy_question_import_batches · academy_question_reviews        │
└──────────────────────────────────────────────────────────────────┘

Go backend (backend/internal/academy/*) is NOT on this path. It owns the K-12
academy and reads the same academy_question_items table for scope IS NULL.
```

The learner never receives the answer key. The draw, the option shuffle, the timer
and the score are computed server-side; the attempt row stores an immutable
`item_snapshot`, and learner DTOs are built from it without correctness fields.

---

## 3. Authn / Authz and the answer-key boundary

- **Learner** (`frontend-web/src/lib/auth/request.ts`): `requireRequestUser` reads
  `Authorization: Bearer <token>` and verifies it via
  `createAdminClient().auth.getUser(token)`; throws `'UNAUTHORIZED'` → mapped to 401.
- **Admin** (`frontend-web/src/server/admin/auth.ts`): `assertAdminPermission`
  accepts **either** `x-admin-key == SPOTLIGHT_ADMIN_API_KEY` **or** a Bearer
  Supabase JWT; role is resolved only from `public.user_roles → roles.slug`,
  fail-closed to `no_access`. Note: the API-key path yields `actorId = 'api-key'`,
  not a UUID — so any actor id stored into an FK (e.g. `reviewer_id`) must be
  nullable/cast to `null`.
- **Separation of duties** on the assessment surface:
  - `programs:manage` → import preview/commit, question edit, exam create/update.
  - `scores:manage` → question review (approve/suspend/reactivate), exam publish/unpublish.
- **Route trust model:** all Film Academy reads/writes go through the **service-role
  client** (`createAdminClient`), which bypasses RLS; ownership is enforced in code,
  not by RLS. `resolveLearner(supabase, userId)` derives the enrolment — the learner
  never supplies an `enrollmentId`. This makes the code-level ownership filters the
  *sole* defence against cross-learner access, and is why the idempotency-resume
  scoping (see §7 / ADR-061) is load-bearing, not cosmetic.

---

## 4. Persistence and migration compatibility matrix

New migration: `supabase/migrations/20271085000000_academy_film_assessment.sql`
(additive-only; verified against the migration-guard rules).

| Object | Created by | This slice | K-12 engine impact | Notes |
|---|---|---|---|---|
| `academy_question_items` | `20260815000800_academy_core.sql` (+`academy_mock_exams.sql`) | **extends**: +`external_code`, `academy_scope`, `film_stage/module_code/department/learning_outcome/cognitive/difficulty/keywords/points/source_version/source_hash/import_batch_id` | **None** — new columns are nullable or defaulted; rows are separated by `academy_scope` | Film rows are `scope='film'`; K-12 rows stay `NULL` and are never drawn by film exams |
| `academy_attempts` | core | untouched | none | The film slice uses `academy_exam_attempts`, not this table |
| `academy_exams` | (pre-existing) | **extends**: +`kind`, `draw_stage`, `draw_module_codes[]`, `draw_count` | additive; defaults keep old rows valid | `draw_count` CHECK bounded 1..200 |
| `academy_exam_attempts` | `20260408110000_academy_hybrid_learning_mvp.sql` | **extends**: +`attempt_state`, `server_deadline`, `item_snapshot`, `idempotency_key` | additive | legacy `status` enum retained for old readers |
| `academy_exam_attempt_responses` | **new** | per-item autosave, `UNIQUE(attempt_id, question_item_id)` | new table, RLS admin-only | |
| `academy_question_import_batches` | **new** | one CSV run, row diagnostics | new table, RLS admin-only | |
| `academy_question_reviews` | **new** | reviewer decision audit ledger | new table, RLS admin-only | reviewer separation (§7.3) |

**Uniqueness / idempotency (security-relevant).** Idempotency on
`academy_exam_attempts.idempotency_key` is scoped to
`UNIQUE(enrollment_id, exam_id, idempotency_key)` — *not* globally unique — and the
resume/race queries filter on the same three columns. A globally-unique key over a
learner-supplied value would let one learner's retry read another learner's live
attempt. See ADR-061.

**Deploy caveat.** This migration is **uncommitted and unapplied** at audit time, so
it was edited in place. If it has already reached any shared database, do **not**
re-run the edited file — ship a follow-up additive migration that
`DROP INDEX IF EXISTS academy_exam_attempts_idem_uniq` then recreates it scoped; that
idempotent re-create is explicitly allowed by the migration guard.

---

## 5. API inventory (Film Academy assessment surface)

Feature-flag-gated by `featureFlags.filmAcademyAssessment()` (env
`FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`, default **off** → 503).

**Learner** (`frontend-web/app/api/academy/*`, Bearer auth):

| Method · path | Purpose | Exposes key? |
|---|---|---|
| GET `/exams` | exams for my programme + can-start/blocker | no |
| POST `/exams/[examId]/attempt` | start or resume (idempotent) | no — presentation ids only |
| GET `/attempts/[attemptId]` | replay saved answers, or result | no — own picks only |
| POST `/attempts/[attemptId]/answer` | autosave one pick | no |
| POST `/attempts/[attemptId]/submit` | finalize + server score | no — aggregate only |

**Admin** (`frontend-web/app/api/admin/academy/*`, `assertAdminPermission`):

| Method · path | Permission | Purpose |
|---|---|---|
| POST `/questions/import-preview` | `programs:manage` | parse+validate CSV, store uncommitted batch |
| POST `/questions/import-commit` | `programs:manage` | re-validate, draft-insert (status stays `draft`) |
| GET `/questions` · PATCH `/questions` | `programs:manage` | list / edit a draft-or-review item |
| GET `/questions/[id]` | `programs:manage` | item + review history |
| POST `/questions/[id]/review` | `scores:manage` | approve / reject / suspend / reactivate |
| GET `/exams` · POST `/exams` | `programs:manage` | list / create exam |
| PATCH `/exams/[id]` | `programs:manage` | update draft/retired exam |
| POST `/exams/[id]/publish` | `scores:manage` | publish (pool preflight) / unpublish |

The 256 starter questions **import as DRAFT**; importing never makes a question
exam-eligible. Exams draw only `status='approved'` items, so an SME must approve
each one. The answer key (`academy_question_items.answer`) never leaves the bank
table; the migration adds no view that exposes it.

---

## 6. Client surfaces

- **Mobile** (`mobile-app/reactnative`): Expo SDK `~54.0.37`, React Native `0.81.6`,
  TypeScript `~5.9.2`, `expo-router ~6.0.23`, `@tanstack/react-query ^5.104.2`,
  `expo-secure-store ~15.0.8`, axios `^1.8.4`. Film Academy `app/film-academy/` holds
  9 screens + layout, including the new `exams.tsx` and `exams/[attemptId].tsx`. It
  calls `/api/academy/*` on frontend-web through the shared axios client
  (`src/api/client.ts`, base URL from `EXPO_PUBLIC_API_BASE_URL`).
- **Admin console** (`frontend-admin`): Next `^16.4.0`, React `^19.3.0`, App Router,
  no UI/table library (plain `<table>` + inline styles). Reaches backend via
  `webProxyBase()` → same-origin `/api/web-proxy` → frontend-web (ADR-047 "Path A").
  The Film Academy page (`app/admin/academy/film/page.tsx`) now spans tabs:
  `batches · applications · tuition · curriculum · progress · submissions ·
  assessment(Import) · bank(Question Bank) · exams · settings`.

---

## 7. Golden rules held by this slice

1. **Additive-only** migrations; the K-12 engine and every legacy reader are untouched.
2. **Never auto-publish**: 256 DRAFTs import as draft; SME review gates exam eligibility.
3. **No answer-key leakage**: learner payloads carry opaque `presentationOptionId`s
   and the learner's own picks only — never correctness, bank option ids, or rationale.
4. **Server-authoritative scoring**: immutable draw snapshot, server deadline,
   per-item autosave, at-most-once submit via a guarded `UPDATE`.
5. **Separation of duties**: `programs:manage` (author) ≠ `scores:manage` (approve/publish).
6. **Code-level ownership** (service-role client bypasses RLS): every learner read is
   scoped by `resolveLearner` + `enrollment_id`; idempotency is scoped per learner/exam.
7. **Money is NAIRA, never ×100** (see §8).
8. **Fail-closed**: feature flag off → 503; empty question pool → exam cannot start
   (`no_eligible_questions`), never a spurious 0% pass.

---

## 8. Money convention (film academy)

Academy fee columns store **whole NAIRA**, not kobo — they predate the kobo
convention used across finance. Authoritative comments:
`mobile-app/reactnative/src/features/filmAcademy/api.ts` ("Do not multiply by 100")
and `frontend-admin/src/services/filmAcademyAdminService.ts` (`training_fee_ngn`,
`fee_ngn`, `application_fee`, `tuition_fee`, `total_amount_ngn` are all whole naira).
`academy_batches.training_fee_ngn` is `NUMERIC(12,2)`. No `×100`/`÷100` conversion
exists on academy fee fields. **Do not introduce one.**

---

## 9. Smoke-test baseline

Automated (reproduced during this slice):

| Check | Command | Result |
|---|---|---|
| Assessment domain logic | `npx vitest run tests/unit/academy/assessment.test.ts` | **21/21 pass** |
| frontend-web lint (assessment + routes) | `npx eslint …/assessment/attempts.ts app/api/academy/exams app/api/academy/attempts app/api/admin/academy` | **exit 0, 0 findings** |
| Mobile typecheck | `tsc --noEmit --incremental` | **exit 0, 0 errors** |
| Mobile web-safety gate | `node scripts/check-no-alert-confirm.mjs` | **no film-academy offenders** |

Not yet run (needs a live/preview environment, tracked as follow-up):

- Browser E2E: import → SME approve → publish → learner start → autosave → submit →
  result, on a preview DB with `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED=true`.
- Cross-learner negative test for the scoped idempotency key.

---

## 10. Known gaps and deferred decisions

- **Unifying the two academy backends** (Go vs frontend-web over one DB) is out of
  scope for this slice; the audit exists to prevent a blind merge.
- **Admin input hardening**: create-exam `program_id` and admin query params are
  truthy-checked but not uuid/enum-validated before the DB call (admin-gated, low
  risk). Tracked, not fixed here.
- **PRD breadth still pending**: offline content sync, portfolio permissions,
  appeals/resubmission, accommodations, instructor analytics, verified-credential
  page (PRD P1/P2) are not in this slice.
- **No ADR recorded yet** for the two-academy / shared-bank decision. Recommend
  **ADR-061** to capture the scoped-idempotency + separation rationale (referenced
  in §4–§5).

---

## 11. Addendum — TMFA topic mastery slice (2026-10-25)

This addendum records the state **after** the topic-mastery implementation. The
architecture decision is now written up as **ADR-061**
(`docs/adr/ADR-061-film-academy-topic-mastery-on-bff-plane.md`): the film academy
stays on the frontend-web BFF over Supabase; the Go K-12 engine is untouched.

### 11.1 New persistence (additive only)

Migration `supabase/migrations/20271099000000_film_academy_topic_mastery.sql`
creates ten new `film_*` tables — `film_curriculum_versions`, `film_courses`,
`film_topics`, `film_topic_media`, `film_topic_attempts`,
`film_topic_attempt_responses`, `film_topic_mastery`, `film_mastery_holds`,
`film_mastery_events`, `film_academic_audit`. Migration
`20271099000001_film_academy_credentials.sql` adds certificate columns and a
unique partial index on `qr_verification_code`. Neither contains a `DROP` or a
`DELETE`, so the migration-guard rules hold.

> **Warning:** an untracked, unreferenced migration
> `20271025001000_purge_film_academy.sql` exists in the working tree. It contains
> nine `DELETE FROM` statements against film programs, lessons, exams, attempts,
> questions and reviews. It is **not** part of this slice, it violates the
> additive-only iron rule, and it must not be applied. It has been left untouched
> for its owner to resolve.

### 11.2 New API surface

Feature flag: `FEATURE_FILM_ACADEMY_TOPICS_ENABLED` (default off → 503).
Separate from the assessment flag.

| Surface | Routes | Auth |
|---|---|---|
| Learner path | `GET /api/academy/topics`, `GET /api/academy/topics/[topicId]` | Bearer + `resolveLearner` |
| Topic quiz | `POST /api/academy/topics/[topicId]/quiz`, `GET/POST /api/academy/topic-attempts/[attemptId]{,/answer,/submit}` | Bearer + `resolveLearner` |
| Article progress | `POST /api/academy/learning/progress`, `GET /api/academy/progress/events` | Bearer + `resolveLearner` |
| Credential | `GET/POST /api/academy/certificate`, public `GET /api/academy/certificates/verify/[identifier]` | Bearer for issue; public verification exposes no PII |
| Admin curriculum | `GET /api/admin/academy/topics`, `GET/PATCH /api/admin/academy/topics/[topicId]`, `GET/POST /api/admin/academy/topics/import` | `programs:manage`; approve/publish actions require `scores:manage` |
| Admin production | `GET /api/admin/academy/media`, `PATCH /api/admin/academy/media/[assetId]` | `programs:manage` |
| Admin mastery | `GET /api/admin/academy/mastery`, `GET/POST /api/admin/academy/holds`, `PATCH /api/admin/academy/holds/[holdId]` | `scores:manage` |
| Admin credentials | `POST /api/admin/academy/certificates` (issue/revoke) | `scores:manage` |

The answer key remains only in `academy_question_items.answer`. Topic attempt
payloads carry presentation option IDs and the learner's own picks; the score,
the immutable draw snapshot and the mastery row are server-derived.

### 11.3 Gate rules now enforced

- **Mastery:** `earned_points * 100 >= possible_points * 85`, integer-only.
- **Publication:** approved article ≥200 chars + ≥20 approved items (or draw
  size if larger) + every mandatory asset published / rights-cleared /
  accessibility-passed / file-backed, unless a signed accessible equivalent with
  a ≥20-character rationale waives media.
- **Sequential unlock:** a topic is `AVAILABLE` only when every prerequisite is
  `MASTERED`; locked topics never render questions.
- **Holds:** open practical/safety/review holds block `MASTERED` independently of
  the quiz score.
- **Credentials:** every topic published, every topic mastered, zero open holds;
  re-checked at issuance; public verification and revocation are audited.

### 11.4 Current content reality (unchanged by the software)

The bundled pack (`frontend-web/src/server/services/academy/topics/data/`) is
13 courses / 72 topics. All of it imports as **draft**:

- 864 media records, all `required`, **0 produced files**, all rights and
  accessibility `NOT REVIEWED` (24 text drafts, 840 "to produce").
- 336 questions, all draft (240 SME review, 96 rewrite-before-use). That is
  ~4.7 per topic; the gate needs ≥20, i.e. ≥1,440 approved items.
- 24 acting topics are faculty-review drafts (442–756 characters each); 48 craft
  topics are "expansion required" briefs with 2 questions each.
- 0 topics published; consequently 0 certificates can issue.

### 11.5 Verification baseline for this addendum

| Check | Result |
|---|---|
| `frontend-web` `tsc --noEmit` | exit 0 |
| `frontend-admin` `tsc --noEmit` | exit 0 |
| Mobile `npm run typecheck` | **exit 2 — 7 errors in unrelated screens/components; 0 in `film-academy`** (see testing report §4) |
| `npx vitest run tests/unit/academy` | 96 passed, 1 skipped (41 new topic-mastery tests) |
| Targeted `eslint` on changed web academy files | exit 0 |
| Admin ESLint | not run — the package has no ESLint config or dependency |

Not run: live migration application, live Supabase import, browser E2E and any
mobile device test. The reports under `docs/academy/TMFA-*.md` repeat these
limits rather than implying live verification.
