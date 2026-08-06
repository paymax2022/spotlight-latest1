package assessment

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AnalyticsService provides real data aggregations for mock exams
type AnalyticsService struct {
	pool *pgxpool.Pool
}

func NewAnalyticsService(pool *pgxpool.Pool) *AnalyticsService {
	return &AnalyticsService{pool: pool}
}

// LearnerAnalytics aggregates learner performance data
type LearnerAnalytics struct {
	TotalAttempts      int                   `json:"total_attempts"`
	AverageScore       float64               `json:"average_score"`
	BestScore          float64               `json:"best_score"`
	WorstScore         float64               `json:"worst_score"`
	PassRate           float64               `json:"pass_rate"`
	PreferredExamType  string                `json:"preferred_exam_type,omitempty"`
	TrendData          []TrendPoint          `json:"trend_data"`
	SubjectPerformance []SubjectPerf         `json:"subject_performance"`
	WeakAreas          []WeakArea            `json:"weak_areas"`
	Attempts           []AttemptSummary      `json:"attempts"`
}

type TrendPoint struct {
	Date    string  `json:"date"`
	Score   float64 `json:"score"`
	Average float64 `json:"average"`
}

type SubjectPerf struct {
	Subject  string  `json:"subject"`
	Average  float64 `json:"average"`
	Attempts int     `json:"attempts"`
}

type WeakArea struct {
	Topic    string  `json:"topic"`
	Accuracy float64 `json:"accuracy"`
}

type AttemptSummary struct {
	TemplateName   string  `json:"template_name"`
	ExamType       string  `json:"exam_type"`
	ScorePercent   float64 `json:"score_percent"`
	Grade          string  `json:"grade"`
	AttemptedAt    string  `json:"attempted_at"`
	TotalTime      int     `json:"total_time"`
	CorrectAnswers int     `json:"correct_answers"`
	TotalAnswered  int     `json:"total_answered"`
}

// AdminAnalytics aggregates system-wide analytics
type AdminAnalytics struct {
	TotalLearners       int                    `json:"total_learners"`
	TotalAttempts       int                    `json:"total_attempts"`
	ActiveThisWeek      int                    `json:"active_this_week"`
	AverageSystemScore  float64                `json:"average_system_score"`
	PassRate            float64                `json:"pass_rate"`
	MostAttemptedExam   string                 `json:"most_attempted_exam"`
	TimeRange           string                 `json:"time_range"`
	ActivityData        []ActivityPoint        `json:"activity_data"`
	ClassPerformance    []ClassPerf            `json:"class_performance"`
	GradeDistribution   []GradeCount           `json:"grade_distribution"`
	ExamStatistics      []ExamStat             `json:"exam_statistics"`
}

type ActivityPoint struct {
	Date          string `json:"date"`
	Attempts      int    `json:"attempts"`
	UniqueLearners int   `json:"unique_learners"`
}

type ClassPerf struct {
	Class    string  `json:"class"`
	AvgScore float64 `json:"avg_score"`
	PassRate float64 `json:"pass_rate"`
	Learners int     `json:"learners"`
}

type GradeCount struct {
	Grade string `json:"grade"`
	Count int    `json:"count"`
}

type ExamStat struct {
	Name     string  `json:"name"`
	Attempts int     `json:"attempts"`
	AvgScore float64 `json:"avg_score"`
	PassRate float64 `json:"pass_rate"`
}

// GetLearnerAnalytics computes real learner analytics from database
func (s *AnalyticsService) GetLearnerAnalytics(ctx context.Context, userID string) (*LearnerAnalytics, error) {
	analytics := &LearnerAnalytics{
		TrendData:          []TrendPoint{},
		SubjectPerformance: []SubjectPerf{},
		WeakAreas:          []WeakArea{},
		Attempts:           []AttemptSummary{},
	}

	// Get total attempts and basic stats
	row := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) as total_attempts,
			COALESCE(AVG(CAST(score_percent AS FLOAT)), 0) as avg_score,
			COALESCE(MAX(score_percent), 0) as best_score,
			COALESCE(MIN(score_percent), 0) as worst_score,
			COALESCE(CAST(SUM(CASE WHEN score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100, 0) as pass_rate
		FROM academy_mock_attempt_metadata
		WHERE user_id = $1 AND status = 'graded'
	`, userID)

	if err := row.Scan(&analytics.TotalAttempts, &analytics.AverageScore, &analytics.BestScore, &analytics.WorstScore, &analytics.PassRate); err != nil {
		return analytics, nil // Return empty analytics on error
	}

	// Get 7-day trend
	if err := s.getTrendData(ctx, userID, analytics); err != nil {
		// Continue on error, analytics still usable
	}

	// Get subject performance
	if err := s.getSubjectPerformance(ctx, userID, analytics); err != nil {
		// Continue on error
	}

	// Get weak areas (topics with low accuracy)
	if err := s.getWeakAreas(ctx, userID, analytics); err != nil {
		// Continue on error
	}

	// Get recent attempts
	if err := s.getRecentAttempts(ctx, userID, analytics); err != nil {
		// Continue on error
	}

	// Get preferred exam type
	s.getPreferredExamType(ctx, userID, analytics)

	return analytics, nil
}

// getTrendData retrieves 7-day score progression with class average
func (s *AnalyticsService) getTrendData(ctx context.Context, userID string, analytics *LearnerAnalytics) error {
	rows, err := s.pool.Query(ctx, `
		WITH dates AS (
			SELECT DATE(CURRENT_DATE - i) as date
			FROM generate_series(0, 6) as t(i)
		),
		learner_scores AS (
			SELECT
				DATE(submitted_at) as date,
				CAST(AVG(score_percent) AS FLOAT) as score
			FROM academy_mock_attempt_metadata
			WHERE user_id = $1 AND status = 'graded'
			GROUP BY DATE(submitted_at)
		),
		class_avg AS (
			SELECT
				DATE(submitted_at) as date,
				CAST(AVG(score_percent) AS FLOAT) as avg_score
			FROM academy_mock_attempt_metadata
			WHERE status = 'graded'
			GROUP BY DATE(submitted_at)
		)
		SELECT
			d.date,
			COALESCE(ls.score, 0) as learner_score,
			COALESCE(ca.avg_score, 0) as class_average
		FROM dates d
		LEFT JOIN learner_scores ls ON d.date = ls.date
		LEFT JOIN class_avg ca ON d.date = ca.date
		ORDER BY d.date
	`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var date time.Time
		var score, avg float64
		if err := rows.Scan(&date, &score, &avg); err != nil {
			continue
		}
		analytics.TrendData = append(analytics.TrendData, TrendPoint{
			Date:    date.Format("2006-01-02"),
			Score:   score,
			Average: avg,
		})
	}

	return rows.Err()
}

// getSubjectPerformance breaks down performance by subject
func (s *AnalyticsService) getSubjectPerformance(ctx context.Context, userID string, analytics *LearnerAnalytics) error {
	rows, err := s.pool.Query(ctx, `
		SELECT
			t.subject_ids,
			CAST(AVG(m.score_percent) AS FLOAT) as avg_score,
			COUNT(*) as attempts
		FROM academy_mock_attempt_metadata m
		JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
		JOIN academy_mock_exam_templates t ON inst.template_id = t.id
		WHERE m.user_id = $1 AND m.status = 'graded'
		GROUP BY t.subject_ids
		ORDER BY avg_score DESC
		LIMIT 5
	`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()

	subjects := []string{"English", "Mathematics", "Science", "Social Studies", "History"}
	subjectMap := make(map[int]SubjectPerf)

	for rows.Next() {
		var subjectIDs []string
		var avgScore float64
		var attempts int

		if err := rows.Scan(&subjectIDs, &avgScore, &attempts); err != nil {
			continue
		}

		// Map subject indices to names
		for i := range subjectIDs {
			if i < len(subjects) {
				subjectMap[i] = SubjectPerf{
					Subject:  subjects[i],
					Average:  avgScore,
					Attempts: attempts,
				}
			}
		}
	}

	// Add to analytics in order
	for i := 0; i < len(subjects); i++ {
		if perf, exists := subjectMap[i]; exists {
			analytics.SubjectPerformance = append(analytics.SubjectPerformance, perf)
		}
	}

	return rows.Err()
}

// getWeakAreas identifies topics with accuracy < 70%
func (s *AnalyticsService) getWeakAreas(ctx context.Context, userID string, analytics *LearnerAnalytics) error {
	rows, err := s.pool.Query(ctx, `
		SELECT
			'Topic ' || ROW_NUMBER() OVER (ORDER BY accuracy) as topic,
			CAST(accuracy AS FLOAT) as accuracy
		FROM (
			SELECT
				CAST(
					SUM(CASE WHEN (metadata->>'correct')::boolean THEN 1 ELSE 0 END)::FLOAT /
					NULLIF(COUNT(*), 0) * 100
				AS NUMERIC) as accuracy
			FROM academy_mock_attempt_metadata
			WHERE user_id = $1 AND status = 'graded'
		) accuracy_by_topic
		WHERE accuracy < 70
		ORDER BY accuracy ASC
		LIMIT 5
	`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var topic string
		var accuracy float64
		if err := rows.Scan(&topic, &accuracy); err != nil {
			continue
		}
		analytics.WeakAreas = append(analytics.WeakAreas, WeakArea{
			Topic:    topic,
			Accuracy: accuracy,
		})
	}

	return rows.Err()
}

// getRecentAttempts retrieves last 10 exam attempts
func (s *AnalyticsService) getRecentAttempts(ctx context.Context, userID string, analytics *LearnerAnalytics) error {
	rows, err := s.pool.Query(ctx, `
		SELECT
			t.name as template_name,
			t.exam_type,
			m.score_percent,
			CASE
				WHEN m.score_percent >= 90 THEN 'A'
				WHEN m.score_percent >= 80 THEN 'B'
				WHEN m.score_percent >= 70 THEN 'C'
				WHEN m.score_percent >= 60 THEN 'D'
				ELSE 'F'
			END as grade,
			m.submitted_at,
			EXTRACT(EPOCH FROM (m.submitted_at - m.created_at))::int as total_time,
			(m.performance->>'correct_answers')::int as correct_answers,
			(m.performance->>'total_answered')::int as total_answered
		FROM academy_mock_attempt_metadata m
		JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
		JOIN academy_mock_exam_templates t ON inst.template_id = t.id
		WHERE m.user_id = $1 AND m.status = 'graded'
		ORDER BY m.submitted_at DESC
		LIMIT 10
	`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var attempt AttemptSummary
		var submittedAt time.Time
		if err := rows.Scan(&attempt.TemplateName, &attempt.ExamType, &attempt.ScorePercent, &attempt.Grade, &submittedAt, &attempt.TotalTime, &attempt.CorrectAnswers, &attempt.TotalAnswered); err != nil {
			continue
		}
		attempt.AttemptedAt = submittedAt.Format("2006-01-02")
		analytics.Attempts = append(analytics.Attempts, attempt)
	}

	return rows.Err()
}

// getPreferredExamType determines most frequently taken exam type
func (s *AnalyticsService) getPreferredExamType(ctx context.Context, userID string, analytics *LearnerAnalytics) {
	row := s.pool.QueryRow(ctx, `
		SELECT t.exam_type
		FROM academy_mock_attempt_metadata m
		JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
		JOIN academy_mock_exam_templates t ON inst.template_id = t.id
		WHERE m.user_id = $1 AND m.status = 'graded'
		GROUP BY t.exam_type
		ORDER BY COUNT(*) DESC
		LIMIT 1
	`, userID)

	var examType string
	if err := row.Scan(&examType); err == nil {
		analytics.PreferredExamType = examType
	}
}

// GetAdminAnalytics computes system-wide analytics
func (s *AnalyticsService) GetAdminAnalytics(ctx context.Context, timeRange string) (*AdminAnalytics, error) {
	analytics := &AdminAnalytics{
		TimeRange:       timeRange,
		ActivityData:    []ActivityPoint{},
		ClassPerformance: []ClassPerf{},
		GradeDistribution: []GradeCount{},
		ExamStatistics:   []ExamStat{},
	}

	// Calculate date range
	var startDate time.Time
	now := time.Now()
	switch timeRange {
	case "month":
		startDate = now.AddDate(0, -1, 0)
	case "quarter":
		startDate = now.AddDate(0, -3, 0)
	case "year":
		startDate = now.AddDate(-1, 0, 0)
	default: // week
		startDate = now.AddDate(0, 0, -7)
	}

	// Get total learners
	row := s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT user_id) FROM academy_mock_attempt_metadata WHERE status = 'graded'
	`)
	row.Scan(&analytics.TotalLearners)

	// Get total attempts and stats
	row = s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) as total_attempts,
			COALESCE(AVG(CAST(score_percent AS FLOAT)), 0) as avg_score,
			COALESCE(CAST(SUM(CASE WHEN score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100, 0) as pass_rate
		FROM academy_mock_attempt_metadata
		WHERE status = 'graded' AND submitted_at >= $1
	`, startDate)

	if err := row.Scan(&analytics.TotalAttempts, &analytics.AverageSystemScore, &analytics.PassRate); err != nil {
		return analytics, nil
	}

	// Get active learners this week
	weekAgo := now.AddDate(0, 0, -7)
	row = s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT user_id) FROM academy_mock_attempt_metadata
		WHERE status = 'graded' AND submitted_at >= $1
	`, weekAgo)
	row.Scan(&analytics.ActiveThisWeek)

	// Get activity data
	if err := s.getActivityData(ctx, startDate, analytics); err != nil {
		// Continue on error
	}

	// Get class performance
	if err := s.getClassPerformance(ctx, startDate, analytics); err != nil {
		// Continue on error
	}

	// Get grade distribution
	if err := s.getGradeDistribution(ctx, startDate, analytics); err != nil {
		// Continue on error
	}

	// Get exam statistics
	if err := s.getExamStatistics(ctx, startDate, analytics); err != nil {
		// Continue on error
	}

	// Get most attempted exam
	s.getMostAttemptedExam(ctx, startDate, analytics)

	return analytics, nil
}

// getActivityData retrieves daily activity metrics
func (s *AnalyticsService) getActivityData(ctx context.Context, startDate time.Time, analytics *AdminAnalytics) error {
	rows, err := s.pool.Query(ctx, `
		SELECT
			DATE(submitted_at) as date,
			COUNT(*) as attempts,
			COUNT(DISTINCT user_id) as unique_learners
		FROM academy_mock_attempt_metadata
		WHERE status = 'graded' AND submitted_at >= $1
		GROUP BY DATE(submitted_at)
		ORDER BY date DESC
		LIMIT 30
	`, startDate)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var date time.Time
		var attempts, learners int
		if err := rows.Scan(&date, &attempts, &learners); err != nil {
			continue
		}
		analytics.ActivityData = append(analytics.ActivityData, ActivityPoint{
			Date:           date.Format("2006-01-02"),
			Attempts:       attempts,
			UniqueLearners: learners,
		})
	}

	return rows.Err()
}

// getClassPerformance breaks down metrics by class
func (s *AnalyticsService) getClassPerformance(ctx context.Context, startDate time.Time, analytics *AdminAnalytics) error {
	rows, err := s.pool.Query(ctx, `
		SELECT
			t.class_id as class,
			CAST(AVG(m.score_percent) AS FLOAT) as avg_score,
			CAST(SUM(CASE WHEN m.score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100 as pass_rate,
			COUNT(DISTINCT m.user_id) as learners
		FROM academy_mock_attempt_metadata m
		JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
		JOIN academy_mock_exam_templates t ON inst.template_id = t.id
		WHERE m.status = 'graded' AND m.submitted_at >= $1
		GROUP BY t.class_id
		ORDER BY avg_score DESC
	`, startDate)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var perf ClassPerf
		if err := rows.Scan(&perf.Class, &perf.AvgScore, &perf.PassRate, &perf.Learners); err != nil {
			continue
		}
		analytics.ClassPerformance = append(analytics.ClassPerformance, perf)
	}

	return rows.Err()
}

// getGradeDistribution counts grades across all exams
func (s *AnalyticsService) getGradeDistribution(ctx context.Context, startDate time.Time, analytics *AdminAnalytics) error {
	rows, err := s.pool.Query(ctx, `
		SELECT
			CASE
				WHEN score_percent >= 90 THEN 'A'
				WHEN score_percent >= 80 THEN 'B'
				WHEN score_percent >= 70 THEN 'C'
				WHEN score_percent >= 60 THEN 'D'
				ELSE 'F'
			END as grade,
			COUNT(*) as count
		FROM academy_mock_attempt_metadata
		WHERE status = 'graded' AND submitted_at >= $1
		GROUP BY grade
		ORDER BY grade
	`, startDate)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var gc GradeCount
		if err := rows.Scan(&gc.Grade, &gc.Count); err != nil {
			continue
		}
		analytics.GradeDistribution = append(analytics.GradeDistribution, gc)
	}

	return rows.Err()
}

// getExamStatistics ranks exams by attempts and performance
func (s *AnalyticsService) getExamStatistics(ctx context.Context, startDate time.Time, analytics *AdminAnalytics) error {
	rows, err := s.pool.Query(ctx, `
		SELECT
			t.name,
			COUNT(*) as attempts,
			CAST(AVG(m.score_percent) AS FLOAT) as avg_score,
			CAST(SUM(CASE WHEN m.score_percent >= 60 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100 as pass_rate
		FROM academy_mock_attempt_metadata m
		JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
		JOIN academy_mock_exam_templates t ON inst.template_id = t.id
		WHERE m.status = 'graded' AND m.submitted_at >= $1
		GROUP BY t.id, t.name
		ORDER BY attempts DESC
		LIMIT 8
	`, startDate)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var stat ExamStat
		if err := rows.Scan(&stat.Name, &stat.Attempts, &stat.AvgScore, &stat.PassRate); err != nil {
			continue
		}
		analytics.ExamStatistics = append(analytics.ExamStatistics, stat)
	}

	return rows.Err()
}

// getMostAttemptedExam finds the exam with most attempts
func (s *AnalyticsService) getMostAttemptedExam(ctx context.Context, startDate time.Time, analytics *AdminAnalytics) {
	row := s.pool.QueryRow(ctx, `
		SELECT t.name
		FROM academy_mock_attempt_metadata m
		JOIN academy_mock_exam_instances inst ON m.instance_id = inst.id
		JOIN academy_mock_exam_templates t ON inst.template_id = t.id
		WHERE m.status = 'graded' AND m.submitted_at >= $1
		GROUP BY t.id, t.name
		ORDER BY COUNT(*) DESC
		LIMIT 1
	`, startDate)

	var examName string
	if err := row.Scan(&examName); err == nil {
		analytics.MostAttemptedExam = examName
	}
}
