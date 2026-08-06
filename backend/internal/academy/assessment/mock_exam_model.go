package assessment

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"

	"github.com/lib/pq"
)

// MockExamTemplate represents a reusable exam blueprint
type MockExamTemplate struct {
	ID                     string          `json:"id"`
	VersionID              string          `json:"version_id"`
	ClassID                string          `json:"class_id"`
	Name                   string          `json:"name"`
	Description            string          `json:"description"`
	ExamType               string          `json:"exam_type"` // class_mock, subject_mock, practice_drill
	SubjectIDs             pq.StringArray  `json:"subject_ids"`
	Sections               json.RawMessage `json:"sections"`
	TotalQuestions         int             `json:"total_questions"`
	TotalSeconds           int             `json:"total_seconds"`
	DifficultyDistribution json.RawMessage `json:"difficulty_distribution"`
	Status                 string          `json:"status"` // draft, approved, archived
	CreatedAt              time.Time       `json:"created_at"`
}

// MockExamInstance represents a shuffled variant of a template
type MockExamInstance struct {
	ID             string          `json:"id"`
	TemplateID     string          `json:"template_id"`
	ExamCode       string          `json:"exam_code"`
	Variant        int             `json:"variant"`
	Seed           int             `json:"seed"`
	MarkingScheme  json.RawMessage `json:"marking_scheme"`
	CreatedAt      time.Time       `json:"created_at"`
}

// MockExamQuestionMapping links questions to exam instances
type MockExamQuestionMapping struct {
	ID                string    `json:"id"`
	InstanceID        string    `json:"instance_id"`
	QuestionItemID    string    `json:"question_item_id"`
	DisplayOrder      int       `json:"display_order"`
	Section           string    `json:"section"`
	TimeAllocatedSec  int       `json:"time_allocated_sec"`
	CreatedAt         time.Time `json:"created_at"`
}

// MockExamAttempt tracks a learner's exam session
type MockExamAttempt struct {
	ID                 string          `json:"id"`
	UserID             string          `json:"user_id"`
	InstanceID         string          `json:"instance_id"`
	TemplateID         string          `json:"template_id"`
	Status             string          `json:"status"` // in_progress, submitted, graded
	Answers            json.RawMessage `json:"answers"`
	Performance        json.RawMessage `json:"performance"`
	FlaggedQuestions   pq.StringArray  `json:"flagged_questions"`
	StartedAt          time.Time       `json:"started_at"`
	SubmittedAt        *time.Time      `json:"submitted_at"`
	CreatedAt          time.Time       `json:"created_at"`
}

// MockExamStatistics aggregates learner performance
type MockExamStatistics struct {
	ID                    string          `json:"id"`
	TemplateID            string          `json:"template_id"`
	TotalAttempts         int             `json:"total_attempts"`
	AvgScorePct           float64         `json:"avg_score_pct"`
	PassRatePct           float64         `json:"pass_rate_pct"`
	MedianTimeSec         int             `json:"median_time_sec"`
	CommonMisconceptions  json.RawMessage `json:"common_misconceptions"`
	DifficultyCalibration json.RawMessage `json:"difficulty_calibration"`
	BySection             json.RawMessage `json:"by_section"`
	UpdatedAt             time.Time       `json:"updated_at"`
}

// MockExamRecommendation suggests mocks to learners
type MockExamRecommendation struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	TemplateID string    `json:"template_id"`
	Reason     string    `json:"reason"` // topic_review, skill_building, readiness_check
	Priority   int       `json:"priority"`
	CreatedAt  time.Time `json:"created_at"`
}

// Requests

type StartMockExamRequest struct {
	TemplateID string `json:"template_id" binding:"required"`
}

type SubmitMockExamRequest struct {
	AttemptID      string                 `json:"attempt_id" binding:"required"`
	Answers        map[string]interface{} `json:"answers" binding:"required"`
	FlaggedQuestions []string             `json:"flagged_questions"`
}

type MockExamFilter struct {
	ClassID    string
	Status     string
	ExamType   string
	Limit      int
	Offset     int
}

// Responses

type MockExamTemplateResponse struct {
	ID                     string          `json:"id"`
	Name                   string          `json:"name"`
	Description            string          `json:"description"`
	ExamType               string          `json:"exam_type"`
	TotalQuestions         int             `json:"total_questions"`
	TotalMinutes           int             `json:"total_minutes"`
	DifficultyDistribution json.RawMessage `json:"difficulty_distribution"`
	Status                 string          `json:"status"`
}

type MockExamInstanceResponse struct {
	ID             string    `json:"id"`
	ExamCode       string    `json:"exam_code"`
	TemplateID     string    `json:"template_id"`
	Variant        int       `json:"variant"`
	TotalQuestions int       `json:"total_questions"`
	TotalMinutes   int       `json:"total_minutes"`
	CreatedAt      time.Time `json:"created_at"`
}

type MockExamAttemptResponse struct {
	ID          string      `json:"id"`
	InstanceID  string      `json:"instance_id"`
	Status      string      `json:"status"`
	Progress    int         `json:"progress"` // percentage
	TimeElapsed int         `json:"time_elapsed"` // seconds
	StartedAt   time.Time   `json:"started_at"`
	Performance interface{} `json:"performance"`
}

type MockExamResultResponse struct {
	ID            string          `json:"id"`
	TemplateID    string          `json:"template_id"`
	Score         float64         `json:"score"`
	ScorePercent  float64         `json:"score_percent"`
	Grade         string          `json:"grade"`
	Status        string          `json:"status"`
	TotalTime     int             `json:"total_time_sec"`
	Performance   json.RawMessage `json:"performance"`
	BySection     json.RawMessage `json:"by_section"`
	SubmittedAt   time.Time       `json:"submitted_at"`
	GradedAt      *time.Time      `json:"graded_at"`
}

// Helper to convert seconds to minutes
func secsToMins(secs int) int {
	if secs <= 0 {
		return 0
	}
	return (secs + 59) / 60 // round up
}

// Value/Scan for JSON types if needed
func (r json.RawMessage) Value() (driver.Value, error) {
	return string(r), nil
}

func (r *json.RawMessage) Scan(value interface{}) error {
	if value == nil {
		*r = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return errors.New("type assertion failed")
	}
	*r = bytes
	return nil
}
