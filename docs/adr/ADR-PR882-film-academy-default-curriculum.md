# ADR-PR882: Default film-academy curriculum with an enrolment fallback

- **Status:** Accepted
- **Date:** 2026-10-23
- **Module:** academy (film academy / LMS)

## Context

An enrolled learner's "My course" screen showed *"Your course is being prepared —
lessons will appear as soon as your tutors publish them"* (`no_curriculum`), and
no admin action resolved it. Three stacked causes:

1. `ensureEnrollment` resolves `academy_enrollments.program_id` as the enrolment
   batch's published program (`academy_programs WHERE batch_id = <batch> AND
   is_published`). Operations create intake batches (e.g. "November 2026 - Batch A")
   separately from the program-bearing demo batches, so no program matched and
   `program_id` was stored **null**.
2. The learner route (`/api/academy/learning`) returns `no_curriculum` whenever
   the resolved `program_id` is null.
3. `academy_modules` / `academy_lessons` were **empty everywhere** — programs are
   seeded but curriculum was always left to admin authoring at
   `/admin/film-academy/curriculum`, and none had been authored.

The product expectation is that enrolment alone yields lessons, with no per-batch
admin authoring.

## Decision

**1. Ship one published default curriculum.** Migration `20271089000000` adds
`academy_programs.is_default` (guarded by a partial unique index so at most one
default exists) and seeds a published default program with 6 modules and 24
lessons of real starter content. The seed is additive, idempotent (fixed UUIDs,
`ON CONFLICT`), and self-contained — it depends on no prior spine content, per the
academy self-contained-seed gotcha.

**2. Fall back to the default at the single resolution point.** `ensureEnrollment`
resolves the default program when the batch has none, and **backfills** existing
null-`program_id` enrolments on their next load, persisting the id. Every
downstream read (candidate dashboard, lesson completion, assignments) is unchanged
because they read the persisted `program_id`.

## Consequences

- Every current and future enrolment gets lessons with no admin action. A batch
  that *does* have its own published program still wins — the default is only a
  fallback.
- The default curriculum is generic starter content; batch-specific programs
  authored by an admin override it per enrolment.
- `is_default` is additive; the partial unique index prevents two defaults.
- Backfill is a one-time write per stale enrolment (only when `program_id` is
  null), then idempotent.

## Alternatives considered

- **Seed curriculum per intake batch.** Rejected: every new intake batch would
  need manual wiring — exactly the admin burden this removes.
- **Per-request fallback without persisting.** Rejected: lesson-completion and
  assignment ownership checks compare against the stored `program_id`; persisting
  once keeps all paths consistent without scattering the fallback.
