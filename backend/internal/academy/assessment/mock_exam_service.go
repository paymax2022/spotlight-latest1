package assessment

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type MockExamService struct {
	repo *MockExamRepository
}

func NewMockExamService(pool *pgxpool.Pool) *MockExamService {
	return &MockExamService{
		repo: NewMockExamRepository(pool),
	}
}

// GetTemplates retrieves available exam templates
func (s *MockExamService) GetTemplates(ctx context.Context, filter MockExamFilter) ([]*MockExamTemplate, error) {
	return s.repo.ListTemplates(ctx, filter)
}

// GetTemplate retrieves a specific template with instance info
func (s *MockExamService) GetTemplate(ctx context.Context, templateID string) (*TemplateDetailResponse, error) {
	template, err := s.repo.GetTemplate(ctx, templateID)
	if err != nil {
		return nil, fmt.Errorf("template not found: %w", err)
	}

	// Fetch available instances
	instances, err := s.repo.GetInstancesByTemplate(ctx, templateID, 10)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch instances: %w", err)
	}

	// Get statistics
	stats, err := s.repo.GetStatistics(ctx, templateID)
	if err != nil {
		// Statistics may not exist yet, that's OK
		stats = nil
	}

	return &TemplateDetailResponse{
		Template:  template,
		Instances: instances,
		Statistics: stats,
	}, nil
}

// StartExam creates a new exam attempt
func (s *MockExamService) StartExam(ctx context.Context, userID, templateID string) (*MockExamAttemptResponse, error) {
	template, err := s.repo.GetTemplate(ctx, templateID)
	if err != nil {
		return nil, fmt.Errorf("template not found: %w", err)
	}

	// Get a random instance (in production, use weighted selection for instance variant)
	instances, err := s.repo.GetInstancesByTemplate(ctx, templateID, 1)
	if err != nil || len(instances) == 0 {
		return nil, fmt.Errorf("no instances available for template: %w", err)
	}

	instance := instances[0]

	// Create attempt record
	attempt, err := s.repo.CreateAttempt(ctx, userID, instance.ID, template.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to create attempt: %w", err)
	}

	return &MockExamAttemptResponse{
		ID:          attempt.ID,
		InstanceID:  instance.ID,
		Status:      "in_progress",
		Progress:    0,
		TimeElapsed: 0,
		StartedAt:   attempt.StartedAt,
	}, nil
}

// GetExamProgress retrieves current exam state (questions + metadata)
func (s *MockExamService) GetExamProgress(ctx context.Context, attemptID string) (*ExamProgressResponse, error) {
	attempt, err := s.repo.GetAttempt(ctx, attemptID)
	if err != nil {
		return nil, fmt.Errorf("attempt not found: %w", err)
	}

	if attempt.Status == "submitted" || attempt.Status == "graded" {
		return nil, fmt.Errorf("exam already submitted")
	}

	instance, err := s.repo.GetInstance(ctx, attempt.InstanceID)
	if err != nil {
		return nil, fmt.Errorf("instance not found: %w", err)
	}

	template, err := s.repo.GetTemplate(ctx, attempt.TemplateID)
	if err != nil {
		return nil, fmt.Errorf("template not found: %w", err)
	}

	// Get question mappings
	mappings, err := s.repo.GetQuestionMappings(ctx, instance.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch questions: %w", err)
	}

	// Calculate time elapsed
	elapsed := int(time.Since(attempt.StartedAt).Seconds())
	progress := int((float64(elapsed) / float64(template.TotalSeconds)) * 100)
	if progress > 100 {
		progress = 100
	}

	// Parse current answers
	var currentAnswers map[string]interface{}
	if attempt.Answers != nil {
		json.Unmarshal(attempt.Answers, &currentAnswers)
	}
	if currentAnswers == nil {
		currentAnswers = make(map[string]interface{})
	}

	return &ExamProgressResponse{
		AttemptID:        attempt.ID,
		ExamCode:         instance.ExamCode,
		TemplateName:     template.Name,
		Progress:         progress,
		TimeElapsed:      elapsed,
		TimeRemaining:    template.TotalSeconds - elapsed,
		TotalQuestions:   len(mappings),
		AnsweredCount:    len(currentAnswers),
		FlaggedCount:     len(attempt.FlaggedQuestions),
		QuestionMappings: mappings,
		CurrentAnswers:   currentAnswers,
	}, nil
}

// SaveProgress updates exam answers and flagged questions
func (s *MockExamService) SaveProgress(ctx context.Context, attemptID string, answers map[string]interface{}, flaggedQuestions []string) error {
	return s.repo.UpdateAttempt(ctx, attemptID, answers, flaggedQuestions)
}

// SubmitExam grades and submits an exam
func (s *MockExamService) SubmitExam(ctx context.Context, attemptID string, answers map[string]interface{}) (*MockExamResultResponse, error) {
	attempt, err := s.repo.GetAttempt(ctx, attemptID)
	if err != nil {
		return nil, fmt.Errorf("attempt not found: %w", err)
	}

	instance, err := s.repo.GetInstance(ctx, attempt.InstanceID)
	if err != nil {
		return nil, fmt.Errorf("instance not found: %w", err)
	}

	// Grade the exam
	result := s.gradeExam(ctx, instance, answers)

	// Save final answers + performance
	perfJSON, _ := json.Marshal(result.Performance)
	answersJSON, _ := json.Marshal(answers)
	if err := s.repo.SubmitAttempt(ctx, attemptID, answersJSON, perfJSON); err != nil {
		return nil, fmt.Errorf("failed to submit exam: %w", err)
	}

	return &MockExamResultResponse{
		ID:           attemptID,
		TemplateID:   attempt.TemplateID,
		Score:        result.Score,
		ScorePercent: result.ScorePercent,
		Grade:        result.Grade,
		Status:       "graded",
		TotalTime:    int(time.Since(attempt.StartedAt).Seconds()),
		Performance:  perfJSON,
		SubmittedAt:  time.Now(),
	}, nil
}

// gradeExam evaluates learner answers against marking scheme
func (s *MockExamService) gradeExam(ctx context.Context, instance *MockExamInstance, answers map[string]interface{}) *ExamGradingResult {
	// Parse marking scheme
	var markingScheme map[string]interface{}
	json.Unmarshal(instance.MarkingScheme, &markingScheme)

	totalMarks := 100 // Default; would come from marking_scheme["total_marks"]
	scoredMarks := 0
	correctAnswers := 0
	totalAnswered := len(answers)

	// Simple grading: compare against answer_keys
	if answerKeys, ok := markingScheme["answer_keys"].(map[string]interface{}); ok {
		for qID, answered := range answers {
			if correct, exists := answerKeys[qID]; exists {
				// Simple string comparison for now
				if fmt.Sprintf("%v", answered) == fmt.Sprintf("%v", correct) {
					correctAnswers++
					scoredMarks += (totalMarks / len(answerKeys)) // distribute marks evenly
				}
			}
		}
	}

	scorePercent := 0.0
	if len(answers) > 0 {
		scorePercent = (float64(scoredMarks) / float64(totalMarks)) * 100
	}

	grade := s.calculateGrade(scorePercent)

	bySection := make(map[string]interface{}) // would be populated in full implementation

	// Persisted shape of academy_mock_attempt_metadata.performance; score_pct
	// feeds v_mock_attempt_scores.score_percent, the rest feeds analytics.
	performance := map[string]interface{}{
		"score_raw":       scoredMarks,
		"score_pct":       scorePercent,
		"grade":           grade,
		"correct_answers": correctAnswers,
		"total_answered":  totalAnswered,
		"by_section":      bySection,
	}

	return &ExamGradingResult{
		Score:          float64(scoredMarks),
		ScorePercent:   scorePercent,
		Grade:          grade,
		CorrectAnswers: correctAnswers,
		TotalAnswered:  totalAnswered,
		BySection:      bySection,
		Performance:    performance,
	}
}

// calculateGrade converts percentage to letter grade
func (s *MockExamService) calculateGrade(percent float64) string {
	switch {
	case percent >= 90:
		return "A"
	case percent >= 80:
		return "B"
	case percent >= 70:
		return "C"
	case percent >= 60:
		return "D"
	default:
		return "F"
	}
}

// GetResults retrieves past exam results for a learner
func (s *MockExamService) GetResults(ctx context.Context, userID string, limit int) ([]*MockExamResultResponse, error) {
	// This would query academy_attempts for graded exams by user_id
	// Placeholder for now
	return make([]*MockExamResultResponse, 0), nil
}

// Response types

type TemplateDetailResponse struct {
	Template   *MockExamTemplate     `json:"template"`
	Instances  []*MockExamInstance   `json:"instances"`
	Statistics *MockExamStatistics   `json:"statistics,omitempty"`
}

type ExamProgressResponse struct {
	AttemptID        string                       `json:"attempt_id"`
	ExamCode         string                       `json:"exam_code"`
	TemplateName     string                       `json:"template_name"`
	Progress         int                          `json:"progress"`
	TimeElapsed      int                          `json:"time_elapsed"`
	TimeRemaining    int                          `json:"time_remaining"`
	TotalQuestions   int                          `json:"total_questions"`
	AnsweredCount    int                          `json:"answered_count"`
	FlaggedCount     int                          `json:"flagged_count"`
	QuestionMappings []*MockExamQuestionMapping   `json:"questions"`
	CurrentAnswers   map[string]interface{}      `json:"current_answers"`
}

type ExamGradingResult struct {
	Score          float64                `json:"score"`
	ScorePercent   float64                `json:"score_percent"`
	Grade          string                 `json:"grade"`
	CorrectAnswers int                    `json:"correct_answers"`
	TotalAnswered  int                    `json:"total_answered"`
	BySection      map[string]interface{} `json:"by_section"`
	Performance    map[string]interface{} `json:"performance"`
}
