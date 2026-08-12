# ADR-028 — Mock-exam attempt state: bridge view + jsonb, not flat columns

**Date:** 2026-08-12
**Status:** Accepted
**Deciders:** Academy/EdTech
**Scope:** `backend/internal/academy/assessment` (mock-exam repository, analytics, service) and one additive migration. No API contract change.

## Context

The Go mock-exam module is schema-incompatible with the database and fails at runtime with
SQLSTATE 42703. Two distinct mismatches:

1. **Analytics** (`mock_exam_analytics.go`) selects `user_id`, `status`, `score_percent`,
   `submitted_at` directly on `academy_mock_attempt_metadata`. That table has only
   `(id, attempt_id, instance_id, template_id, performance jsonb, flagged_questions, created_at)` —
   the flat columns never existed. The fresh-replay fix already merged to develop
   (`0be84c6d`…`7cb4ddc6`) repaired the *materialized views* that had the same bug by adding a
   **bridge view `v_mock_attempt_scores`** deriving those columns from `academy_attempts` +
   `performance->>'score_pct'` — it did **not** add columns.
2. **Repository** (`mock_exam_repository.go`) reads/writes `academy_attempts` with columns that
   don't exist there either (`status` — the real column is `state` with a different vocabulary —
   plus `answers`, `instance_id`, `template_id`, `flagged_questions`, `updated_at`).
   `CreateAttempt` filters `WHERE blueprint_id IS NULL`, which can never match because
   `blueprint_id` is `NOT NULL`.

Two options were on the table:

- **(a) Bridge view for reads, real tables for writes** — point analytics/repository reads at
  `v_mock_attempt_scores`; keep lifecycle state on `academy_attempts`
  (`state`/`started_at`/`submitted_at`), score inside `performance` jsonb, and mock-only mutable
  state (`answers`, `flagged_questions`) on the metadata side-table.
- **(b) Additive migration adding the flat columns** (`user_id`, `status`, `answers`,
  `score_percent`, `started_at`, `submitted_at`, `updated_at`) to
  `academy_mock_attempt_metadata` and keeping the backend as-is.

## Decision

**Option (a).** Option (b) is rejected on two grounds:

- It creates **two sources of truth**: `academy_mock_attempt_metadata.attempt_id` is
  `NOT NULL UNIQUE REFERENCES academy_attempts(id)`, so every mock attempt must have an
  `academy_attempts` row regardless — duplicating `user_id`/`status`/`submitted_at` onto the
  side-table guarantees drift, and the already-merged bridge view (which the materialized views
  consume) would disagree with the flat columns the moment either is written independently.
- It **doesn't actually fix the module**: the repository's broken queries target
  `academy_attempts`, not the metadata table, so "keep the backend as-is" is not available.

Concretely:

- **Reads** (`GetAttempt`, `GetResults`, all of `mock_exam_analytics.go`) go through
  `v_mock_attempt_scores`, extended (append-only `CREATE OR REPLACE VIEW`) with
  `performance`, `answers`, `flagged_questions`, `started_at`, `created_at`. The view's `status`
  maps the `academy_attempts.state` machine onto the mock vocabulary:
  `scored|reviewed → graded`, `submitted → submitted`, else `in_progress`.
- **Writes**: `CreateAttempt` inserts the `academy_attempts` row (`state='started'`) and the
  metadata row in one CTE statement; `UpdateAttempt` touches only metadata
  (`answers`, `flagged_questions`, `updated_at`); `SubmitAttempt` writes `performance` to
  metadata and flips `academy_attempts.state='scored'`, `submitted_at=now()`.
- **The public attempt id is `academy_mock_attempt_metadata.id`** (what the old code returned
  from `CreateAttempt`); the view exposes it as `id`.
- The service's `gradeExam` now populates `performance` with
  `{score_raw, score_pct, grade, correct_answers, total_answered, by_section}` (the shape the
  migration comment documents and the bridge view's `score_percent` depends on).

### Migration (additive-only) — `20261111000000_mock_exam_attempt_state.sql`

- `ALTER TABLE academy_attempts ALTER COLUMN blueprint_id DROP NOT NULL` — mock attempts have no
  CBT blueprint (a blueprint requires an exam arena; inventing sentinel arenas/blueprints per
  mock template is strictly worse). This is a **constraint widening**, not a drop/rename/narrowing:
  every existing row and every existing writer (the CBT exam module always supplies
  `blueprint_id`) is unaffected. CBT queries that inner-join blueprints naturally exclude mock
  attempts, which is the desired scoping.
- `ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'`, `updated_at timestamptz NOT NULL
  DEFAULT now()` on `academy_mock_attempt_metadata` — mock-only mutable state lives on the
  mock-only table; it duplicates nothing.
- `CREATE OR REPLACE VIEW v_mock_attempt_scores` — same leading columns (names/types/order
  unchanged), new columns appended, `status` CASE completed as above. The materialized views only
  consume `status='graded'`, whose mapping is unchanged.

## Consequences

- One source of truth per fact: lifecycle on `academy_attempts`, score in `performance` jsonb
  (projected as `score_percent` by the view), mock-only blobs on the metadata table.
- `blueprint_id` is now nullable; any future query that assumes "every attempt has a blueprint"
  must join, not select bare. Mock attempts are distinguishable via
  `academy_mock_attempt_metadata`.
- Analytics SQL gains one join (inside the view) versus flat columns; these endpoints are
  low-volume and the heavy aggregations already run off the materialized views.
- Live-DB test `backend/tests/academy/mock_exam_live_test.go` (gated on `TEST_DATABASE_URL`)
  exercises create → save → submit → read-back → analytics against the real replayed schema, so
  the module can never silently drift from the migrations again.
