// Package learner is the Spotlight Academy per-learner surface: personal
// bookmarks + notes (server-persisted), full-text-ish search over the published
// curriculum, and the daily-goal/streak summary.
//
// NOTE on JSON shape: unlike most academy packages (snake_case + {data} envelope)
// these DTOs are tagged camelCase and returned bare, to match the pre-existing
// mobile contract (features/academy/api.ts) exactly — the mobile branches consume
// the response body directly, so no client adapter is needed.
package learner

// Bookmark is one saved item (public.academy_learner_bookmarks).
type Bookmark struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // lesson|topic|past_question
	Title       string `json:"title"`
	SubjectName string `json:"subjectName"`
	Href        string `json:"href"`
	Ts          string `json:"ts"` // ISO8601 (created_at)
}

// Note is one lesson note (public.academy_learner_notes).
type Note struct {
	ID          string `json:"id"`
	LessonID    string `json:"lessonId"`
	LessonTitle string `json:"lessonTitle"`
	SubjectName string `json:"subjectName"`
	Body        string `json:"body"`
	Ts          string `json:"ts"` // ISO8601 (created_at)
}

// SearchResult is one hit from the curriculum search.
type SearchResult struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"` // lesson|topic|subject
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	Href     string `json:"href"`
	Icon     string `json:"icon"`
}

// StreakDay is one cell of the daily-goal calendar grid.
type StreakDay struct {
	Date  string `json:"date"`  // yyyy-mm-dd
	State string `json:"state"` // studied|frozen|missed|today|future
}

// DailyGoal is the learner's daily study summary + streak calendar.
type DailyGoal struct {
	GoalMinutes  int         `json:"goalMinutes"`
	DoneMinutes  int         `json:"doneMinutes"`
	StreakDays   int         `json:"streakDays"`
	FreezeTokens int         `json:"freezeTokens"`
	Calendar     []StreakDay `json:"calendar"`
}

// ── Request DTOs (match the mobile POST bodies) ─────────────────────────────────

// CreateBookmarkRequest is the body for POST /learner/bookmarks.
type CreateBookmarkRequest struct {
	Kind        string `json:"kind"`
	Title       string `json:"title" binding:"required"`
	SubjectName string `json:"subjectName"`
	Href        string `json:"href" binding:"required"`
}

// CreateNoteRequest is the body for POST /learner/notes.
type CreateNoteRequest struct {
	LessonID    string `json:"lessonId" binding:"required"`
	LessonTitle string `json:"lessonTitle"`
	SubjectName string `json:"subjectName"`
	Body        string `json:"body" binding:"required"`
}
