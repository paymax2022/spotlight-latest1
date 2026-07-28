package learn

import "fmt"

// ──────────────────────────────────────────────────────────────────────────
// Paymax Invest · Learn Center — domain model.
//
// The Learn Center is an education-first, read-mostly surface. Content
// (paths / lessons / quizzes / glossary) is server-driven config: the mobile
// client renders exactly what the payload describes (see mobile
// features/learn/types/learn.types.ts — this model is its server counterpart).
//
// The ONLY mutation is submitting a quiz for scoring. Scoring is authoritative
// on the server (the client never decides pass/fail): the answer key lives in
// learn_quiz_options.is_correct and is never serialised to the client.
// ──────────────────────────────────────────────────────────────────────────

// LearnLevel is the audience / track a path belongs to (drives chip styling
// client-side). Kept as an open string enum, validated at the DB CHECK.
type LearnLevel string

const (
	LevelBeginner LearnLevel = "beginner"
	LevelStock    LearnLevel = "stock"
	LevelCrypto   LearnLevel = "crypto"
	LevelWealth   LearnLevel = "wealth"
)

// LessonKind is how a lesson is consumed.
type LessonKind string

const (
	LessonArticle LessonKind = "article"
	LessonVideo   LessonKind = "video"
)

// LearnPath is a curated track of lessons. progress_pct is per-learner and is
// derived from learn_lesson_progress (server-tracked), not stored on the path.
type LearnPath struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	IconColor   string     `json:"iconColor"`
	Level       LearnLevel `json:"level"`
	LessonIDs   []string   `json:"lessonIds"`
	ProgressPct int        `json:"progressPct"`
}

// Lesson is a single article or video unit inside a path.
type Lesson struct {
	ID           string     `json:"id"`
	PathID       string     `json:"pathId"`
	Title        string     `json:"title"`
	DurationMins int        `json:"durationMins"`
	Kind         LessonKind `json:"kind"`
	Body         string     `json:"body"`
	Summary      string     `json:"summary"`
}

// QuizOption — note: `correct` is only ever populated server-side during scoring
// and is omitted from the client-facing quiz payload (json:"correct" is always
// false in the GET quiz response; the answer key never leaves the server).
type QuizOption struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Correct bool   `json:"correct"`
}

type QuizQuestion struct {
	ID      string       `json:"id"`
	Prompt  string       `json:"prompt"`
	Options []QuizOption `json:"options"`
}

// Quiz is an optional knowledge check attached to a lesson.
type Quiz struct {
	ID        string         `json:"id"`
	LessonID  string         `json:"lessonId"`
	Questions []QuizQuestion `json:"questions"`
}

// QuizAnswers maps questionId → chosen optionId (the submit body).
type QuizAnswers map[string]string

// QuizResult is the server-authoritative scoring result.
type QuizResult struct {
	Score  int  `json:"score"`
	Total  int  `json:"total"`
	Passed bool `json:"passed"`
}

// GlossaryTerm is a plain-English definition.
type GlossaryTerm struct {
	Term       string `json:"term"`
	Definition string `json:"definition"`
}

// QuizPassRatio mirrors the mobile QUIZ_PASS_RATIO — pass threshold is a
// fraction of correct answers. Kept server-side so the client can never lower it.
const QuizPassRatio = 0.7

// Sentinel errors — mapped to HTTP status in the handler.
var (
	ErrNotFound  = fmt.Errorf("learn: not found")
	ErrForbidden = fmt.Errorf("learn: forbidden")
	ErrBadInput  = fmt.Errorf("learn: invalid input")
)
