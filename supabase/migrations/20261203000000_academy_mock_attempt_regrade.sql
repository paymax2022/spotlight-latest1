-- academy_mock_attempt_regrade
--
-- Data fix: regrade historical mock-exam attempts scored under the
-- integer-division defect fixed in PR #83 (gradeExam distributed marks as
-- totalMarks / len(answerKeys) with integer math, so a perfect 60-question
-- exam scored 60/100 and 45/60 correct scored 45 instead of 75).
--
-- Recomputes performance from the persisted answers against the instance's
-- marking_scheme.answer_keys — the same comparison the fixed Go grader makes
-- (fraction correct × total_marks, default 100). Only rows whose stored
-- score_pct differs from the recomputation (>0.01) are touched, which makes
-- the update idempotent and skips attempts graded after the fix. Prior values
-- are preserved under performance->'regrade'. Additive-only: UPDATE of a
-- jsonb projection column; no DDL, no row deletion.
--
-- Guarded on table existence so the migration replays cleanly on databases
-- that do not carry the mock-exam module.

DO $regrade$
DECLARE
  n_regraded integer;
BEGIN
  IF to_regclass('public.academy_mock_attempt_metadata') IS NULL
     OR to_regclass('public.academy_attempts') IS NULL
     OR to_regclass('public.academy_mock_exam_instances') IS NULL THEN
    RAISE NOTICE 'academy mock-exam tables absent — skipping regrade';
    RETURN;
  END IF;

  WITH regraded AS (
    SELECT m.id,
           m.performance AS prev,
           calc.correct,
           (SELECT count(*) FROM jsonb_object_keys(m.answers)) AS total_answered,
           round(calc.correct::numeric / calc.total_keys * 100, 10) AS pct,
           COALESCE(NULLIF(i.marking_scheme->>'total_marks','')::numeric, 100) AS total_marks
    FROM academy_mock_attempt_metadata m
    JOIN academy_attempts a ON a.id = m.attempt_id
    JOIN academy_mock_exam_instances i ON i.id = m.instance_id
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE m.answers->>k.key = k.value) AS correct,
             count(*) AS total_keys
      FROM jsonb_each_text(i.marking_scheme->'answer_keys') AS k(key, value)
    ) calc
    WHERE a.state IN ('scored', 'reviewed')
      AND m.answers IS NOT NULL
      AND m.performance IS NOT NULL
      AND jsonb_typeof(i.marking_scheme->'answer_keys') = 'object'
      AND calc.total_keys > 0
  )
  UPDATE academy_mock_attempt_metadata m
  SET performance = m.performance
        || jsonb_build_object(
             'score_raw',       r.pct / 100 * r.total_marks,
             'score_pct',       r.pct,
             'grade',           CASE WHEN r.pct >= 90 THEN 'A'
                                     WHEN r.pct >= 80 THEN 'B'
                                     WHEN r.pct >= 70 THEN 'C'
                                     WHEN r.pct >= 60 THEN 'D'
                                     ELSE 'F' END,
             'correct_answers', r.correct,
             'total_answered',  r.total_answered,
             'regrade',         jsonb_build_object(
                                  'reason',         'integer-division mark distribution (PR #83)',
                                  'migration',      '20261203000000',
                                  'regraded_at',    now(),
                                  'prev_score_raw', r.prev->'score_raw',
                                  'prev_score_pct', r.prev->'score_pct',
                                  'prev_grade',     r.prev->'grade')),
      updated_at = now()
  FROM regraded r
  WHERE m.id = r.id
    AND abs(COALESCE(NULLIF(r.prev->>'score_pct','')::numeric, -1) - r.pct) > 0.01;

  GET DIAGNOSTICS n_regraded = ROW_COUNT;
  RAISE NOTICE 'regraded % mock-exam attempt(s)', n_regraded;

  -- The analytics materialized views aggregate performance->>'score_pct';
  -- refresh the ones that exist so they reflect the corrected scores.
  IF to_regclass('public.mv_learner_analytics_daily') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW mv_learner_analytics_daily;
  END IF;
  IF to_regclass('public.mv_performance_trends_weekly') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW mv_performance_trends_weekly;
  END IF;
  IF to_regclass('public.mv_class_performance_analytics') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW mv_class_performance_analytics;
  END IF;
  IF to_regclass('public.mv_exam_popularity_ranking') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW mv_exam_popularity_ranking;
  END IF;
  IF to_regclass('public.mv_subject_performance_comparison') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW mv_subject_performance_comparison;
  END IF;
END
$regrade$;
