package learner

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	goalMinutes      = 20 // default daily study target
	minutesPerActive = 5  // rough estimate: each logged progress event ≈ 5 minutes
	calendarDays     = 35 // ~5 weeks of streak-grid cells
	calendarFuture   = 7  // days shown ahead of today (fill the current week)
	searchLimit      = 30
)

// Service is the learner-surface application layer.
type Service struct {
	repo *Repository
	now  func() time.Time // injectable clock (tests)
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(db), now: time.Now}
}

// WithClock overrides the clock (tests).
func (s *Service) WithClock(now func() time.Time) *Service { s.now = now; return s }

// ── Bookmarks / notes passthroughs ──────────────────────────────────────────

func (s *Service) ListBookmarks(ctx context.Context, userID string) ([]Bookmark, error) {
	return s.repo.ListBookmarks(ctx, userID)
}
func (s *Service) CreateBookmark(ctx context.Context, userID string, req CreateBookmarkRequest) (*Bookmark, error) {
	return s.repo.CreateBookmark(ctx, userID, req)
}
func (s *Service) DeleteBookmark(ctx context.Context, userID, id string) error {
	return s.repo.DeleteBookmark(ctx, userID, id)
}
func (s *Service) ListNotes(ctx context.Context, userID string) ([]Note, error) {
	return s.repo.ListNotes(ctx, userID)
}
func (s *Service) CreateNote(ctx context.Context, userID string, req CreateNoteRequest) (*Note, error) {
	return s.repo.CreateNote(ctx, userID, req)
}
func (s *Service) DeleteNote(ctx context.Context, userID, id string) error {
	return s.repo.DeleteNote(ctx, userID, id)
}

// Search matches the published curriculum by a case-insensitive substring. Empty
// query returns no results (never a full dump).
func (s *Service) Search(ctx context.Context, query string) ([]SearchResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return []SearchResult{}, nil
	}
	// Escape ILIKE wildcards in the user input so % / _ are literal.
	esc := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(q)
	return s.repo.Search(ctx, "%"+esc+"%", searchLimit)
}

// DailyGoal builds the study summary + streak calendar. doneMinutes is estimated
// from today's logged activity; streak/freezes come from the gamification profile;
// each calendar cell is studied/today/future/missed. The grid spans
// [today-27 .. today+7] so the current week has forward cells.
func (s *Service) DailyGoal(ctx context.Context, userID string) (*DailyGoal, error) {
	now := s.now().UTC()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	start := todayMidnight.AddDate(0, 0, -(calendarDays - calendarFuture - 1))
	today := todayMidnight.Format("2006-01-02")

	studied, err := s.repo.StudiedDates(ctx, userID, start)
	if err != nil {
		return nil, err
	}
	streak, freezes, err := s.repo.StreakSummary(ctx, userID)
	if err != nil {
		return nil, err
	}

	cal := make([]StreakDay, 0, calendarDays)
	for i := 0; i < calendarDays; i++ {
		ds := start.AddDate(0, 0, i).Format("2006-01-02")
		cal = append(cal, StreakDay{Date: ds, State: cellState(ds, today, studied[ds] > 0)})
	}

	return &DailyGoal{
		GoalMinutes:  goalMinutes,
		DoneMinutes:  studied[today] * minutesPerActive,
		StreakDays:   streak,
		FreezeTokens: freezes,
		Calendar:     cal,
	}, nil
}

// cellState classifies one calendar day (yyyy-mm-dd). today/future take priority
// over activity; a past day is studied iff the learner logged activity that day,
// else missed. Lexical compare is chronological for yyyy-mm-dd.
func cellState(day, today string, studied bool) string {
	switch {
	case day == today:
		return "today"
	case day > today:
		return "future"
	case studied:
		return "studied"
	default:
		return "missed"
	}
}
