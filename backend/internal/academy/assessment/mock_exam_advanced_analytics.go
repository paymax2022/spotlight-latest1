package assessment

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AdvancedAnalyticsService provides insights from materialized views
type AdvancedAnalyticsService struct {
	pool *pgxpool.Pool
}

func NewAdvancedAnalyticsService(pool *pgxpool.Pool) *AdvancedAnalyticsService {
	return &AdvancedAnalyticsService{pool: pool}
}

// PerformanceTrend represents performance data over time
type PerformanceTrend struct {
	Date               time.Time `json:"date"`
	UniqueLearnersCount int       `json:"unique_learners_count"`
	TotalAttempts      int       `json:"total_attempts"`
	SystemAvgScore     float64   `json:"system_avg_score"`
	SystemPassRate     float64   `json:"system_pass_rate"`
}

// ClassMetrics represents performance metrics for a class
type ClassMetrics struct {
	ClassID       string  `json:"class_id"`
	UniqueLearnersCount int     `json:"unique_learners_count"`
	TotalAttempts int     `json:"total_attempts"`
	AvgScore      float64 `json:"avg_score"`
	BestScore     float64 `json:"best_score"`
	WorstScore    float64 `json:"worst_score"`
	PassRate      float64 `json:"pass_rate"`
	ExcellentRate float64 `json:"excellent_rate"`
	FailRate      float64 `json:"fail_rate"`
	LastAttempt   time.Time `json:"last_attempt"`
}

// ExamRanking represents exam popularity and performance
type ExamRanking struct {
	TemplateID     string  `json:"template_id"`
	Name           string  `json:"name"`
	ExamType       string  `json:"exam_type"`
	ClassID        string  `json:"class_id"`
	TotalAttempts  int     `json:"total_attempts"`
	UniqueLearnersCount int     `json:"unique_learners_count"`
	AvgScore       float64 `json:"avg_score"`
	PassRate       float64 `json:"pass_rate"`
	ExcellentRate  float64 `json:"excellent_rate"`
	PopularityRank int     `json:"popularity_rank"`
	WeeklyAttempts int     `json:"weekly_attempts"`
}

// GradeDistribution represents grade counts by date
type GradeDistribution struct {
	Date       time.Time `json:"date"`
	Grade      string    `json:"grade"`
	Count      int       `json:"count"`
	Percentage float64   `json:"percentage"`
}

// RetentionCohort represents learner retention data
type RetentionCohort struct {
	CohortWeek     time.Time `json:"cohort_week"`
	RetentionBucket string    `json:"retention_bucket"`
	LearnerCount   int       `json:"learner_count"`
	RetentionRate  float64   `json:"retention_rate"`
}

// SubjectPerformance represents subject difficulty and performance
type SubjectPerformance struct {
	ClassID       string  `json:"class_id"`
	SubjectID     string  `json:"subject_id"`
	Attempts      int     `json:"attempts"`
	UniqueLearnersCount int     `json:"unique_learners_count"`
	AvgScore      float64 `json:"avg_score"`
	PassRate      float64 `json:"pass_rate"`
	DifficultyRank int     `json:"difficulty_rank"`
}

// GetPerformanceTrends retrieves weekly performance trends
func (s *AdvancedAnalyticsService) GetPerformanceTrends(ctx context.Context, weeks int) ([]PerformanceTrend, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			week_start,
			unique_learners,
			total_attempts,
			system_avg_score,
			system_pass_rate
		FROM mv_performance_trends_weekly
		WHERE week_start >= CURRENT_DATE - INTERVAL '1 week' * $1
		ORDER BY week_start DESC
		LIMIT $1
	`, weeks, weeks)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trends []PerformanceTrend
	for rows.Next() {
		var trend PerformanceTrend
		if err := rows.Scan(&trend.Date, &trend.UniqueLearnersCount, &trend.TotalAttempts, &trend.SystemAvgScore, &trend.SystemPassRate); err != nil {
			continue
		}
		trends = append(trends, trend)
	}

	return trends, rows.Err()
}

// GetClassComparison retrieves comparative metrics across all classes
func (s *AdvancedAnalyticsService) GetClassComparison(ctx context.Context) ([]ClassMetrics, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			class_id,
			unique_learners,
			total_attempts,
			avg_score,
			best_score,
			worst_score,
			pass_rate,
			excellent_rate,
			fail_rate,
			last_attempt
		FROM mv_class_performance_analytics
		ORDER BY avg_score DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var metrics []ClassMetrics
	for rows.Next() {
		var m ClassMetrics
		if err := rows.Scan(&m.ClassID, &m.UniqueLearnersCount, &m.TotalAttempts, &m.AvgScore, &m.BestScore, &m.WorstScore, &m.PassRate, &m.ExcellentRate, &m.FailRate, &m.LastAttempt); err != nil {
			continue
		}
		metrics = append(metrics, m)
	}

	return metrics, rows.Err()
}

// GetExamRankings retrieves top exams by popularity and performance
func (s *AdvancedAnalyticsService) GetExamRankings(ctx context.Context, limit int) ([]ExamRanking, error) {
	if limit <= 0 {
		limit = 20
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			template_id,
			name,
			exam_type,
			class_id,
			total_attempts,
			unique_learners,
			avg_score,
			pass_rate,
			excellent_rate,
			popularity_rank,
			weekly_attempts
		FROM mv_exam_popularity_ranking
		ORDER BY popularity_rank ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rankings []ExamRanking
	for rows.Next() {
		var r ExamRanking
		if err := rows.Scan(&r.TemplateID, &r.Name, &r.ExamType, &r.ClassID, &r.TotalAttempts, &r.UniqueLearnersCount, &r.AvgScore, &r.PassRate, &r.ExcellentRate, &r.PopularityRank, &r.WeeklyAttempts); err != nil {
			continue
		}
		rankings = append(rankings, r)
	}

	return rankings, rows.Err()
}

// GetGradeDistributionTrend retrieves grade distribution over time
func (s *AdvancedAnalyticsService) GetGradeDistributionTrend(ctx context.Context, days int) (map[string][]GradeDistribution, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			date,
			grade,
			count,
			percentage
		FROM mv_grade_distribution_trends
		WHERE date >= CURRENT_DATE - INTERVAL '1 day' * $1
		ORDER BY date DESC, grade
	`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]GradeDistribution)
	for rows.Next() {
		var gd GradeDistribution
		if err := rows.Scan(&gd.Date, &gd.Grade, &gd.Count, &gd.Percentage); err != nil {
			continue
		}
		dateKey := gd.Date.Format("2006-01-02")
		result[dateKey] = append(result[dateKey], gd)
	}

	return result, rows.Err()
}

// GetRetentionAnalysis retrieves learner retention by cohort
func (s *AdvancedAnalyticsService) GetRetentionAnalysis(ctx context.Context) ([]RetentionCohort, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			cohort_week,
			retention_bucket,
			learner_count,
			retention_rate
		FROM mv_learner_retention_cohorts
		ORDER BY cohort_week DESC, retention_bucket
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cohorts []RetentionCohort
	for rows.Next() {
		var c RetentionCohort
		if err := rows.Scan(&c.CohortWeek, &c.RetentionBucket, &c.LearnerCount, &c.RetentionRate); err != nil {
			continue
		}
		cohorts = append(cohorts, c)
	}

	return cohorts, rows.Err()
}

// GetSubjectDifficulty ranks subjects by difficulty (lowest pass rate first)
func (s *AdvancedAnalyticsService) GetSubjectDifficulty(ctx context.Context, classID string) ([]SubjectPerformance, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			class_id,
			subject_id,
			attempts,
			unique_learners,
			avg_score,
			pass_rate,
			difficulty_rank
		FROM mv_subject_performance_comparison
		WHERE class_id = $1
		ORDER BY difficulty_rank ASC
	`, classID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subjects []SubjectPerformance
	for rows.Next() {
		var sp SubjectPerformance
		if err := rows.Scan(&sp.ClassID, &sp.SubjectID, &sp.Attempts, &sp.UniqueLearnersCount, &sp.AvgScore, &sp.PassRate, &sp.DifficultyRank); err != nil {
			continue
		}
		subjects = append(subjects, sp)
	}

	return subjects, rows.Err()
}

// RefreshAnalyticsViews refreshes all materialized views
// Returns timing information for each view refresh
func (s *AdvancedAnalyticsService) RefreshAnalyticsViews(ctx context.Context) (map[string]float64, error) {
	rows, err := s.pool.Query(ctx, "SELECT refresh_mock_exam_analytics()")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]float64)
	for rows.Next() {
		var viewName string
		var refreshTime float64
		if err := rows.Scan(&viewName, &refreshTime); err != nil {
			continue
		}
		result[viewName] = refreshTime
	}

	return result, rows.Err()
}

// GetAnalyticsHealth returns health information about materialized views
type AnalyticsHealth struct {
	ViewName       string    `json:"view_name"`
	RowCount       int64     `json:"row_count"`
	LastRefresh    time.Time `json:"last_refresh"`
	RefreshTimeMs  float64   `json:"refresh_time_ms"`
	IsHealthy      bool      `json:"is_healthy"`
}

// GetViewsHealth checks the health of all materialized views
func (s *AdvancedAnalyticsService) GetViewsHealth(ctx context.Context) ([]AnalyticsHealth, error) {
	// This would query pg_stat_user_tables or similar
	// For now, return empty as a placeholder
	var health []AnalyticsHealth
	return health, nil
}
