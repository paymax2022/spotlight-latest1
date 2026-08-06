package assessment

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MockExamRepository struct {
	pool *pgxpool.Pool
}

func NewMockExamRepository(pool *pgxpool.Pool) *MockExamRepository {
	return &MockExamRepository{pool: pool}
}

// GetTemplate retrieves an exam template by ID
func (r *MockExamRepository) GetTemplate(ctx context.Context, templateID string) (*MockExamTemplate, error) {
	const query = `
		SELECT id, version_id, class_id, name, description, exam_type, subject_ids,
		       sections, total_questions, total_seconds, difficulty_distribution,
		       status, created_at
		FROM academy_mock_exam_templates
		WHERE id = $1 AND status != 'archived'
	`
	row := r.pool.QueryRow(ctx, query, templateID)
	return scanTemplate(row)
}

// ListTemplates retrieves exam templates with optional filters
func (r *MockExamRepository) ListTemplates(ctx context.Context, filter MockExamFilter) ([]*MockExamTemplate, error) {
	query := `
		SELECT id, version_id, class_id, name, description, exam_type, subject_ids,
		       sections, total_questions, total_seconds, difficulty_distribution,
		       status, created_at
		FROM academy_mock_exam_templates
		WHERE status = 'approved'
	`
	args := []interface{}{}
	argNum := 1

	if filter.ClassID != "" {
		query += fmt.Sprintf(` AND class_id = $%d`, argNum)
		args = append(args, filter.ClassID)
		argNum++
	}
	if filter.ExamType != "" {
		query += fmt.Sprintf(` AND exam_type = $%d`, argNum)
		args = append(args, filter.ExamType)
		argNum++
	}

	query += ` ORDER BY created_at DESC`

	if filter.Limit > 0 {
		query += fmt.Sprintf(` LIMIT $%d`, argNum)
		args = append(args, filter.Limit)
		argNum++
	}
	if filter.Offset > 0 {
		query += fmt.Sprintf(` OFFSET $%d`, argNum)
		args = append(args, filter.Offset)
	}

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	templates := make([]*MockExamTemplate, 0)
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		templates = append(templates, t)
	}

	return templates, rows.Err()
}

// GetInstance retrieves an exam instance by ID
func (r *MockExamRepository) GetInstance(ctx context.Context, instanceID string) (*MockExamInstance, error) {
	const query = `
		SELECT id, template_id, exam_code, variant, seed, marking_scheme, created_at
		FROM academy_mock_exam_instances
		WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, query, instanceID)
	return scanInstance(row)
}

// GetInstanceByCode retrieves an exam instance by exam code
func (r *MockExamRepository) GetInstanceByCode(ctx context.Context, examCode string) (*MockExamInstance, error) {
	const query = `
		SELECT id, template_id, exam_code, variant, seed, marking_scheme, created_at
		FROM academy_mock_exam_instances
		WHERE exam_code = $1
	`
	row := r.pool.QueryRow(ctx, query, examCode)
	return scanInstance(row)
}

// GetInstancesByTemplate retrieves all instances for a template
func (r *MockExamRepository) GetInstancesByTemplate(ctx context.Context, templateID string, limit int) ([]*MockExamInstance, error) {
	query := `
		SELECT id, template_id, exam_code, variant, seed, marking_scheme, created_at
		FROM academy_mock_exam_instances
		WHERE template_id = $1
		ORDER BY variant
	`
	args := []interface{}{templateID}
	if limit > 0 {
		query += ` LIMIT $2`
		args = append(args, limit)
	}

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	instances := make([]*MockExamInstance, 0)
	for rows.Next() {
		i, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		instances = append(instances, i)
	}

	return instances, rows.Err()
}

// GetQuestionMappings retrieves all questions for an exam instance
func (r *MockExamRepository) GetQuestionMappings(ctx context.Context, instanceID string) ([]*MockExamQuestionMapping, error) {
	const query = `
		SELECT id, instance_id, question_item_id, display_order, section,
		       time_allocated_sec, created_at
		FROM academy_mock_question_mappings
		WHERE instance_id = $1
		ORDER BY display_order
	`
	rows, err := r.pool.Query(ctx, query, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	mappings := make([]*MockExamQuestionMapping, 0)
	for rows.Next() {
		var m MockExamQuestionMapping
		if err := rows.Scan(&m.ID, &m.InstanceID, &m.QuestionItemID, &m.DisplayOrder,
			&m.Section, &m.TimeAllocatedSec, &m.CreatedAt); err != nil {
			return nil, err
		}
		mappings = append(mappings, &m)
	}

	return mappings, rows.Err()
}

// CreateAttempt creates a new exam attempt for a learner
func (r *MockExamRepository) CreateAttempt(ctx context.Context, userID, instanceID, templateID string) (*MockExamAttempt, error) {
	const query = `
		INSERT INTO academy_mock_attempt_metadata (attempt_id, instance_id, template_id, performance, created_at)
		SELECT id, $2, $3, '{}', NOW()
		FROM academy_attempts
		WHERE user_id = $1 AND blueprint_id IS NULL
		LIMIT 1
		RETURNING id, user_id, instance_id, template_id, status, answers, performance,
		          flagged_questions, started_at, submitted_at, created_at
	`
	// Note: This is a simplified version. In production, you'd create an academy_attempts record first.
	row := r.pool.QueryRow(ctx, query, userID, instanceID, templateID)

	var attempt MockExamAttempt
	err := row.Scan(&attempt.ID, &attempt.UserID, &attempt.InstanceID, &attempt.TemplateID,
		&attempt.Status, &attempt.Answers, &attempt.Performance, &attempt.FlaggedQuestions,
		&attempt.StartedAt, &attempt.SubmittedAt, &attempt.CreatedAt)

	if err != nil {
		return nil, err
	}

	return &attempt, nil
}

// GetAttempt retrieves an attempt by ID
func (r *MockExamRepository) GetAttempt(ctx context.Context, attemptID string) (*MockExamAttempt, error) {
	const query = `
		SELECT id, user_id, instance_id, template_id, status, answers, performance,
		       flagged_questions, started_at, submitted_at, created_at
		FROM academy_attempts
		WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, query, attemptID)

	var attempt MockExamAttempt
	err := row.Scan(&attempt.ID, &attempt.UserID, &attempt.InstanceID, &attempt.TemplateID,
		&attempt.Status, &attempt.Answers, &attempt.Performance, &attempt.FlaggedQuestions,
		&attempt.StartedAt, &attempt.SubmittedAt, &attempt.CreatedAt)

	if err != nil {
		return nil, err
	}

	return &attempt, nil
}

// UpdateAttempt updates an attempt's answers and flagged questions
func (r *MockExamRepository) UpdateAttempt(ctx context.Context, attemptID string, answers map[string]interface{}, flaggedQuestions []string) error {
	answersJSON, _ := json.Marshal(answers)

	const query = `
		UPDATE academy_attempts
		SET answers = $1, flagged_questions = $2, updated_at = NOW()
		WHERE id = $3
	`
	_, err := r.pool.Exec(ctx, query, answersJSON, flaggedQuestions, attemptID)
	return err
}

// SubmitAttempt marks an attempt as submitted and grades it
func (r *MockExamRepository) SubmitAttempt(ctx context.Context, attemptID string, performance json.RawMessage) error {
	const query = `
		UPDATE academy_attempts
		SET status = 'graded', performance = $1, submitted_at = NOW(), updated_at = NOW()
		WHERE id = $2
	`
	_, err := r.pool.Exec(ctx, query, performance, attemptID)
	return err
}

// GetStatistics retrieves performance stats for a template
func (r *MockExamRepository) GetStatistics(ctx context.Context, templateID string) (*MockExamStatistics, error) {
	const query = `
		SELECT id, template_id, total_attempts, avg_score_pct, pass_rate_pct,
		       median_time_sec, common_misconceptions, difficulty_calibration,
		       by_section, updated_at
		FROM academy_mock_statistics
		WHERE template_id = $1
	`
	row := r.pool.QueryRow(ctx, query, templateID)

	var stats MockExamStatistics
	err := row.Scan(&stats.ID, &stats.TemplateID, &stats.TotalAttempts, &stats.AvgScorePct,
		&stats.PassRatePct, &stats.MedianTimeSec, &stats.CommonMisconceptions,
		&stats.DifficultyCalibration, &stats.BySection, &stats.UpdatedAt)

	if err != nil {
		return nil, err
	}

	return &stats, nil
}

// Helper scanners

func scanTemplate(row pgx.Row) (*MockExamTemplate, error) {
	var t MockExamTemplate
	err := row.Scan(&t.ID, &t.VersionID, &t.ClassID, &t.Name, &t.Description, &t.ExamType,
		&t.SubjectIDs, &t.Sections, &t.TotalQuestions, &t.TotalSeconds,
		&t.DifficultyDistribution, &t.Status, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func scanInstance(row pgx.Row) (*MockExamInstance, error) {
	var i MockExamInstance
	err := row.Scan(&i.ID, &i.TemplateID, &i.ExamCode, &i.Variant, &i.Seed,
		&i.MarkingScheme, &i.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &i, nil
}
