-- Materialized Views for Mock Exam Analytics (Slice 11)
-- These views provide pre-aggregated data for faster reporting
-- Refresh strategy: nightly (or on-demand after significant events)

-- ══════════════════════════════════════════════════════════════════════════════
-- Bridge view (fresh-replay fix): the analytics below were authored against a
-- flat attempt schema (user_id / submitted_at / status / score_percent columns
-- on academy_mock_attempt_metadata) that never existed — the real table keeps
-- the score inside the `performance` jsonb and the learner/submission fields
-- on academy_attempts. Every fresh replay died with `column m.score_percent
-- does not exist`. This view derives exactly those columns from the real
-- schema; attempts in state scored/reviewed surface as status='graded'.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_mock_attempt_scores AS
SELECT
    m.id,
    m.attempt_id,
    m.instance_id,
    m.template_id,
    a.user_id,
    a.submitted_at,
    CASE WHEN a.state IN ('scored','reviewed') THEN 'graded' ELSE a.state END AS status,
    NULLIF(m.performance->>'score_pct', '')::numeric AS score_percent
FROM academy_mock_attempt_metadata m
JOIN academy_attempts a ON a.id = m.attempt_id;

-- ══════════════════════════════════════════════════════════════════════════════
-- Daily Learner Analytics - aggregates learner performance by day
-- ══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_learner_analytics_daily AS
SELECT
    m.user_id,
    DATE(m.submitted_at) as date,
    COUNT(*) as attempts,
    COUNT(CASE WHEN m.score_percent >= 60 THEN 1 END) as passes,
    CAST(AVG(m.score_percent) AS NUMERIC(5, 2)) as avg_score,
    CAST(MAX(m.score_percent) AS NUMERIC(5, 2)) as best_score,
    CAST(MIN(m.score_percent) AS NUMERIC(5, 2)) as worst_score,
    CAST(
        CAST(SUM(CASE WHEN m.score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS NUMERIC(5, 2)
    ) as pass_rate,
    t.class_id,
    t.exam_type
FROM v_mock_attempt_scores m
JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
JOIN academy_mock_exam_templates t ON inst.template_id = t.id
WHERE m.status = 'graded'
GROUP BY m.user_id, DATE(m.submitted_at), t.class_id, t.exam_type
WITH DATA;

CREATE INDEX IF NOT EXISTS idx_mv_learner_daily_user_date
    ON mv_learner_analytics_daily(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_learner_daily_date
    ON mv_learner_analytics_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_learner_daily_class
    ON mv_learner_analytics_daily(class_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- Weekly Trends - performance trends by week for all learners
-- ══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_performance_trends_weekly AS
SELECT
    DATE_TRUNC('week', m.submitted_at)::DATE as week_start,
    COUNT(DISTINCT m.user_id) as unique_learners,
    COUNT(*) as total_attempts,
    CAST(AVG(m.score_percent) AS NUMERIC(5, 2)) as system_avg_score,
    CAST(
        CAST(SUM(CASE WHEN m.score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS NUMERIC(5, 2)
    ) as system_pass_rate
FROM v_mock_attempt_scores m
WHERE m.status = 'graded'
GROUP BY DATE_TRUNC('week', m.submitted_at)
WITH DATA;

CREATE INDEX IF NOT EXISTS idx_mv_trends_weekly_date
    ON mv_performance_trends_weekly(week_start DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- Class Performance Analytics - compare performance across classes
-- ══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_class_performance_analytics AS
SELECT
    t.class_id,
    COUNT(DISTINCT m.user_id) as unique_learners,
    COUNT(*) as total_attempts,
    CAST(AVG(m.score_percent) AS NUMERIC(5, 2)) as avg_score,
    CAST(MAX(m.score_percent) AS NUMERIC(5, 2)) as best_score,
    CAST(MIN(m.score_percent) AS NUMERIC(5, 2)) as worst_score,
    CAST(
        CAST(SUM(CASE WHEN m.score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS NUMERIC(5, 2)
    ) as pass_rate,
    CAST(
        CAST(SUM(CASE WHEN m.score_percent >= 90 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS NUMERIC(5, 2)
    ) as excellent_rate,
    CAST(
        CAST(SUM(CASE WHEN m.score_percent < 60 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS NUMERIC(5, 2)
    ) as fail_rate,
    MAX(m.submitted_at) as last_attempt
FROM v_mock_attempt_scores m
JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
JOIN academy_mock_exam_templates t ON inst.template_id = t.id
WHERE m.status = 'graded'
GROUP BY t.class_id
WITH DATA;

CREATE INDEX IF NOT EXISTS idx_mv_class_perf_class_id
    ON mv_class_performance_analytics(class_id);
CREATE INDEX IF NOT EXISTS idx_mv_class_perf_avg_score
    ON mv_class_performance_analytics(avg_score DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- Exam Popularity Ranking - top exams by attempts and performance
-- ══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_exam_popularity_ranking AS
SELECT
    t.id as template_id,
    t.name,
    t.exam_type,
    t.class_id,
    COUNT(*) as total_attempts,
    COUNT(DISTINCT m.user_id) as unique_learners,
    CAST(AVG(m.score_percent) AS NUMERIC(5, 2)) as avg_score,
    CAST(
        CAST(SUM(CASE WHEN m.score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS NUMERIC(5, 2)
    ) as pass_rate,
    CAST(
        CAST(SUM(CASE WHEN m.score_percent >= 90 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS NUMERIC(5, 2)
    ) as excellent_rate,
    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as popularity_rank,
    MAX(m.submitted_at) as last_attempt,
    COUNT(*) FILTER (WHERE DATE(m.submitted_at) >= CURRENT_DATE - INTERVAL '7 days') as weekly_attempts
FROM v_mock_attempt_scores m
JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
JOIN academy_mock_exam_templates t ON inst.template_id = t.id
WHERE m.status = 'graded'
GROUP BY t.id, t.name, t.exam_type, t.class_id
WITH DATA;

CREATE INDEX IF NOT EXISTS idx_mv_exam_pop_rank
    ON mv_exam_popularity_ranking(popularity_rank);
CREATE INDEX IF NOT EXISTS idx_mv_exam_pop_class
    ON mv_exam_popularity_ranking(class_id);
CREATE INDEX IF NOT EXISTS idx_mv_exam_pop_attempts
    ON mv_exam_popularity_ranking(total_attempts DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- Grade Distribution Trends - how grades are distributed over time
-- ══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_grade_distribution_trends AS
SELECT
    DATE(m.submitted_at) as date,
    CASE
        WHEN m.score_percent >= 90 THEN 'A'
        WHEN m.score_percent >= 80 THEN 'B'
        WHEN m.score_percent >= 70 THEN 'C'
        WHEN m.score_percent >= 60 THEN 'D'
        ELSE 'F'
    END as grade,
    COUNT(*) as count,
    CAST(
        CAST(COUNT(*) AS FLOAT) / SUM(COUNT(*)) OVER (PARTITION BY DATE(m.submitted_at))
        * 100 AS NUMERIC(5, 2)
    ) as percentage
FROM v_mock_attempt_scores m
WHERE m.status = 'graded'
GROUP BY DATE(m.submitted_at), grade
WITH DATA;

CREATE INDEX IF NOT EXISTS idx_mv_grade_dist_date
    ON mv_grade_distribution_trends(date DESC);
CREATE INDEX IF NOT EXISTS idx_mv_grade_dist_grade
    ON mv_grade_distribution_trends(grade);

-- ══════════════════════════════════════════════════════════════════════════════
-- Learner Retention Cohorts - track learner engagement over time
-- ══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_learner_retention_cohorts AS
WITH first_attempt AS (
    SELECT
        user_id,
        DATE(MIN(submitted_at)) as first_attempt_date
    FROM v_mock_attempt_scores
    WHERE status = 'graded'
    GROUP BY user_id
),
retention_days AS (
    SELECT
        fa.user_id,
        fa.first_attempt_date,
        DATE(m.submitted_at) as attempt_date,
        (DATE(m.submitted_at) - fa.first_attempt_date)::INT as days_since_first,
        CASE
            WHEN (DATE(m.submitted_at) - fa.first_attempt_date)::INT <= 1 THEN 'Day 1'
            WHEN (DATE(m.submitted_at) - fa.first_attempt_date)::INT <= 7 THEN 'Week 1'
            WHEN (DATE(m.submitted_at) - fa.first_attempt_date)::INT <= 30 THEN 'Month 1'
            WHEN (DATE(m.submitted_at) - fa.first_attempt_date)::INT <= 90 THEN 'Quarter 1'
            ELSE 'Day 90+'
        END as retention_bucket
    FROM first_attempt fa
    JOIN v_mock_attempt_scores m ON fa.user_id = m.user_id
    WHERE m.status = 'graded'
),
-- Cohort denominators as a joined CTE — the original correlated subquery
-- referenced an ungrouped outer column (42803) and could never build.
cohort_sizes AS (
    SELECT
        DATE_TRUNC('week', first_attempt_date)::DATE as cohort_week,
        COUNT(DISTINCT user_id) as cohort_size
    FROM first_attempt
    GROUP BY DATE_TRUNC('week', first_attempt_date)::DATE
)
SELECT
    DATE_TRUNC('week', rd.first_attempt_date)::DATE as cohort_week,
    rd.retention_bucket,
    COUNT(DISTINCT rd.user_id) as learner_count,
    CAST(
        CAST(COUNT(DISTINCT rd.user_id) AS FLOAT)
        / NULLIF(cs.cohort_size, 0) * 100 AS NUMERIC(5, 2)
    ) as retention_rate
FROM retention_days rd
JOIN cohort_sizes cs ON cs.cohort_week = DATE_TRUNC('week', rd.first_attempt_date)::DATE
GROUP BY DATE_TRUNC('week', rd.first_attempt_date)::DATE, rd.retention_bucket, cs.cohort_size
WITH DATA;

CREATE INDEX IF NOT EXISTS idx_mv_cohort_week
    ON mv_learner_retention_cohorts(cohort_week DESC);
CREATE INDEX IF NOT EXISTS idx_mv_cohort_bucket
    ON mv_learner_retention_cohorts(retention_bucket);

-- ══════════════════════════════════════════════════════════════════════════════
-- Subject Performance Comparison - identify strong/weak subjects
-- ══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_subject_performance_comparison AS
SELECT
    t.class_id,
    UNNEST(t.subject_ids) as subject_id,
    COUNT(*) as attempts,
    COUNT(DISTINCT m.user_id) as unique_learners,
    CAST(AVG(m.score_percent) AS NUMERIC(5, 2)) as avg_score,
    CAST(
        CAST(SUM(CASE WHEN m.score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100 AS NUMERIC(5, 2)
    ) as pass_rate,
    ROW_NUMBER() OVER (PARTITION BY t.class_id ORDER BY AVG(m.score_percent) ASC) as difficulty_rank
FROM v_mock_attempt_scores m
JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
JOIN academy_mock_exam_templates t ON inst.template_id = t.id
WHERE m.status = 'graded'
GROUP BY t.class_id, subject_id
WITH DATA;

CREATE INDEX IF NOT EXISTS idx_mv_subject_class
    ON mv_subject_performance_comparison(class_id);
CREATE INDEX IF NOT EXISTS idx_mv_subject_rank
    ON mv_subject_performance_comparison(difficulty_rank);

-- ══════════════════════════════════════════════════════════════════════════════
-- Refresh Function - scheduled refresh of all materialized views
-- Call via: SELECT refresh_mock_exam_analytics();
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_mock_exam_analytics()
RETURNS TABLE (view_name TEXT, refresh_time NUMERIC) AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_duration NUMERIC;
BEGIN
    v_start_time := CLOCK_TIMESTAMP();
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_learner_analytics_daily;
    v_duration := EXTRACT(MILLISECOND FROM CLOCK_TIMESTAMP() - v_start_time);
    RETURN QUERY SELECT 'mv_learner_analytics_daily'::TEXT, v_duration;

    v_start_time := CLOCK_TIMESTAMP();
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_performance_trends_weekly;
    v_duration := EXTRACT(MILLISECOND FROM CLOCK_TIMESTAMP() - v_start_time);
    RETURN QUERY SELECT 'mv_performance_trends_weekly'::TEXT, v_duration;

    v_start_time := CLOCK_TIMESTAMP();
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_class_performance_analytics;
    v_duration := EXTRACT(MILLISECOND FROM CLOCK_TIMESTAMP() - v_start_time);
    RETURN QUERY SELECT 'mv_class_performance_analytics'::TEXT, v_duration;

    v_start_time := CLOCK_TIMESTAMP();
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_exam_popularity_ranking;
    v_duration := EXTRACT(MILLISECOND FROM CLOCK_TIMESTAMP() - v_start_time);
    RETURN QUERY SELECT 'mv_exam_popularity_ranking'::TEXT, v_duration;

    v_start_time := CLOCK_TIMESTAMP();
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_grade_distribution_trends;
    v_duration := EXTRACT(MILLISECOND FROM CLOCK_TIMESTAMP() - v_start_time);
    RETURN QUERY SELECT 'mv_grade_distribution_trends'::TEXT, v_duration;

    v_start_time := CLOCK_TIMESTAMP();
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_learner_retention_cohorts;
    v_duration := EXTRACT(MILLISECOND FROM CLOCK_TIMESTAMP() - v_start_time);
    RETURN QUERY SELECT 'mv_learner_retention_cohorts'::TEXT, v_duration;

    v_start_time := CLOCK_TIMESTAMP();
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_subject_performance_comparison;
    v_duration := EXTRACT(MILLISECOND FROM CLOCK_TIMESTAMP() - v_start_time);
    RETURN QUERY SELECT 'mv_subject_performance_comparison'::TEXT, v_duration;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════════════
-- Scheduled Refresh (optional - requires pg_cron extension)
-- Uncomment to enable nightly refresh at 2 AM UTC
-- ══════════════════════════════════════════════════════════════════════════════

-- SELECT cron.schedule('refresh_mock_exam_analytics', '0 2 * * *', 'SELECT refresh_mock_exam_analytics()');
