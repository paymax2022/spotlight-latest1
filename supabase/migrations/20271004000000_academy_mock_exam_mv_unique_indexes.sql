-- Academy mock-exam analytics — unique indexes for CONCURRENTLY refresh (additive).
--
-- refresh_mock_exam_analytics() runs REFRESH MATERIALIZED VIEW CONCURRENTLY on
-- all seven mv_* views, but none carried a WHERE-free UNIQUE index — a hard
-- Postgres precondition — so every call failed 55000. All seven get a unique
-- index on their GROUP BY natural key; the key columns derive from NOT NULL
-- source columns so no NULL-keyed rows exist.
BEGIN;

-- (user_id, date, class_id, exam_type) is the view's GROUP BY natural key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_learner_daily_key
    ON public.mv_learner_analytics_daily (user_id, date, class_id, exam_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_trends_weekly_key
    ON public.mv_performance_trends_weekly (week_start);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_class_perf_key
    ON public.mv_class_performance_analytics (class_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_exam_pop_key
    ON public.mv_exam_popularity_ranking (template_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_grade_dist_key
    ON public.mv_grade_distribution_trends (date, grade);

-- cohort_size is functionally dependent on cohort_week (COUNT(DISTINCT user_id)
-- per week), so (cohort_week, retention_bucket) is the natural key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_cohort_key
    ON public.mv_learner_retention_cohorts (cohort_week, retention_bucket);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_subject_perf_key
    ON public.mv_subject_performance_comparison (class_id, subject_id);

COMMIT;
