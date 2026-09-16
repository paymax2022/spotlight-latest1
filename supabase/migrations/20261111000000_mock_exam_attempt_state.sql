-- Mock-exam attempt state — align the schema with the Go assessment module.
-- See docs/adr/ADR-028-mock-exam-attempt-state.md.
-- Additive-only: one constraint widening, two new columns, append-only view extension.
BEGIN;

-- 1. Mock attempts have no CBT blueprint (blueprints require an exam arena).
--    Widening only: existing rows keep their values and the CBT exam module
--    always supplies blueprint_id on insert.
ALTER TABLE public.academy_attempts
  ALTER COLUMN blueprint_id DROP NOT NULL;

-- 2. Mock-only mutable state lives on the mock-only side-table.
ALTER TABLE public.academy_mock_attempt_metadata
  ADD COLUMN IF NOT EXISTS answers    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 3. Extend the bridge view (introduced by 20260806000003): leading columns keep
--    their names/types/order (CREATE OR REPLACE requirement), new columns are
--    appended. status now covers the full academy_attempts state machine with the
--    mock-exam vocabulary; the analytics materialized views only consume
--    status = 'graded', whose mapping is unchanged.
CREATE OR REPLACE VIEW v_mock_attempt_scores AS
SELECT
    m.id,
    m.attempt_id,
    m.instance_id,
    m.template_id,
    a.user_id,
    a.submitted_at,
    CASE
      WHEN a.state IN ('scored','reviewed') THEN 'graded'
      WHEN a.state = 'submitted'            THEN 'submitted'
      ELSE 'in_progress'
    END AS status,
    NULLIF(m.performance->>'score_pct', '')::numeric AS score_percent,
    m.performance,
    m.answers,
    m.flagged_questions,
    COALESCE(a.started_at, a.created_at) AS started_at,
    m.created_at
FROM academy_mock_attempt_metadata m
JOIN academy_attempts a ON a.id = m.attempt_id;

COMMIT;
