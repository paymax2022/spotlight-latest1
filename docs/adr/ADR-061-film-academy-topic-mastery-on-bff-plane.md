# ADR-061: Film Academy topic mastery and credentials stay on the frontend-web BFF plane

- **Status:** Accepted
- **Date:** 2026-10-25
- **Module:** academy (film academy / LMS)
- **Supersedes:** nothing. Extends the architecture recorded in
  `docs/academy/current-state-audit.md` and ADR-047 (admin console Path A).

## Context

The MASTER IMPLEMENTATION DIRECTIVE describes a production LMS: curriculum import,
a topic path, secure 85% topic assessments, practical holds, mastery, media
production gates and verified credentials. Its wording assumes "the backend" is a
single service, but this repository has two academy planes:

1. **K-12 Spotlight Academy** — Go (gin + pgx), mounted at
   `/api/finance/academy/*`, reading NERDC question items (`academy_scope IS NULL`).
2. **Timeless Movies Film Academy** — Next.js route handlers in `frontend-web`,
   using the Supabase service-role client, reading/writing `academy_scope = 'film'`
   rows in the same database. Tuition, applications, curriculum, assignments and
   the existing assessment slice already live here.

Moving the film academy to Go would require re-implementing every existing film
surface and rewriting the mobile/admin API contracts — both forbidden by the
directive ("do not rebuild working modules", "do not break API contracts"). The
audit (§0) already recorded that the assessment slice extends a frontend-web-owned
surface and that the Go engine does not know its tables exist.

A second open question was where *new* LMS tables should live: on top of the
legacy `academy_modules`/`academy_lessons` pathway, or in a dedicated topic
hierarchy. The TMFA pack uses stable course IDs (ACT, C01–C12) and 72 stable topic
IDs with integer mastery gates; the legacy pathway has no stable topic identity,
no publication gate and no media production state.

## Decision

**1. The frontend-web BFF remains the authoritative film-academy plane.** The
topic mastery slice is implemented as new route handlers + services in
`frontend-web`, backed by Supabase. The Go K-12 engine is untouched. Like the
existing film assessment slice, all access goes through the service-role client,
so ownership is enforced in code (`resolveLearner`, `assertAdminPermission`), not
by RLS.

**2. New, isolated `film_*` tables — no overload of the legacy pathway.**
Migration `20271099000000_film_academy_topic_mastery.sql` adds ten additive tables
(curriculum versions, courses, topics, media, attempts, responses, mastery, holds,
events, academic audit). `academy_modules`/`academy_lessons` keep serving the
existing curriculum UI; the TMFA path is a parallel, stable-ID hierarchy. The
question bank stays shared but scoped: topic quizzes draw only
`academy_question_items` where `academy_scope = 'film'`.

**3. One pure arithmetic authority for mastery.** `passesTopicQuiz` evaluates
`earned_points * 100 >= possible_points * threshold` with integers and rejects
impossible inputs. Display percentages never feed a gate. Both the service layer
and the unit tests call this one function.

**4. Publication is a server-evaluated gate, never a UI toggle.** A topic publishes
only when the article is approved (≥200 chars), the approved pool covers
`max(20, drawCount)`, every mandatory media asset is `PUBLISHED` with rights
`CLEARED` and accessibility `PASSED` and a real file URL where the type requires
one — or an authorised accessible text equivalent is signed with a ≥20-character
rationale. Saving changes to approved content returns it to review.

**5. Credentials are earned and verifiable.** `academy_certificates` is extended
(additive, `20271099000001_film_academy_credentials.sql`). Issuance recomputes the
whole ledger: every topic must be published, every one `MASTERED`, and no hold
open. The public verification route returns only holder display name, programme,
completion date and status — no email, phone, user id or enrollment id. Revoked
credentials remain resolvable as `revoked`, never 404.

**6. Near-real-time delivery without a new socket service.** Grades, mastery and
holds append to `film_mastery_events`; the mobile client polls with a monotonic
cursor and scopes dedupe by a unique `dedupe_key`. Multi-device reconciliation
follows without introducing a second realtime backbone.

**7. Fail-closed feature flag.** `FEATURE_FILM_ACADEMY_TOPICS_ENABLED` (default
off) gates every new learner and admin route with 503. It is intentionally
separate from `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`: the topic path can be
imported and reviewed before any topic quiz is publishable.

## Consequences

- **No cross-plane migration risk.** The K-12 Go engine and every legacy film
  reader (tuition, applications, assignments, assessment) are untouched; the new
  columns/tables are additive and the new tables are not read by old code.
- **The BFF is the security boundary.** Because the service-role client bypasses
  RLS, every learner query must filter by the resolved enrollment, and every
  admin route must call `assertAdminPermission` with the correct permission.
  Idempotency keys are scoped per learner/exam/attempt — never global.
- **Content and software are separate deliverables.** The bundled pack imports
  13 courses / 72 topics / 864 planned media / 336 draft questions. Nothing in
  the pack is approved or produced, and 336 items cannot satisfy a 20-per-topic
  pool (≥1,440 needed). The software is complete; the curriculum is not
  publishable. This ADR does not claim otherwise.
- **Certificate strictness.** A credential requires the *entire* published
  curriculum to be mastered. A partial pilot cohort cannot be certified by
  publishing only a subset — that is deliberate, and admins who want a partial
  credential need a separate product decision, not a code flag.
- **Operational dependency on Supabase.** Film academy availability follows the
  Supabase project and the frontend-web deployment; there is no Go fallback.
  This is already true for tuition and the assessment slice.
- **Follow-up.** Applying the migrations, importing the pack and any live E2E
  verification require a real Supabase environment with the flag enabled; none
  of that was executed in this implementation run.

## Alternatives considered

- **Move the film academy to the Go backend.** Rejected: rebuilds working
  modules, breaks the mobile/admin API contracts, and duplicates the tuition and
  assessment planes mid-flight.
- **Reuse `academy_modules`/`academy_lessons` for topics.** Rejected: no stable
  topic IDs, no integer mastery ledger, no media production state, and it would
  force the K-12 curriculum readers to understand film-specific columns.
- **Store media state in a JSON blob on the topic.** Rejected: rights and
  accessibility review are per-asset audit decisions; a blob cannot be indexed,
  counted, or constrained per asset.
- **Issue certificates from a client-declared completion flag.** Rejected: that
  would make the credential unearned and unverifiable.
