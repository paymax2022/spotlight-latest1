package learner

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("learner: not found")

// Repository is the pgx data-access layer for the learner surface.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// ── Bookmarks ───────────────────────────────────────────────────────────────

func (r *Repository) ListBookmarks(ctx context.Context, userID string) ([]Bookmark, error) {
	const q = `
		SELECT id, kind, title, subject_name, href, created_at
		FROM public.academy_learner_bookmarks
		WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Bookmark{}
	for rows.Next() {
		var b Bookmark
		var ts time.Time
		if err := rows.Scan(&b.ID, &b.Kind, &b.Title, &b.SubjectName, &b.Href, &ts); err != nil {
			return nil, err
		}
		b.Ts = iso(ts)
		out = append(out, b)
	}
	return out, rows.Err()
}

// CreateBookmark upserts by (user_id, href) so re-bookmarking the same target is
// idempotent (returns the existing/updated row).
func (r *Repository) CreateBookmark(ctx context.Context, userID string, req CreateBookmarkRequest) (*Bookmark, error) {
	kind := req.Kind
	if kind != "lesson" && kind != "topic" && kind != "past_question" {
		kind = "lesson"
	}
	const q = `
		INSERT INTO public.academy_learner_bookmarks (user_id, kind, title, subject_name, href)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id, href)
		DO UPDATE SET title = EXCLUDED.title, subject_name = EXCLUDED.subject_name, kind = EXCLUDED.kind
		RETURNING id, kind, title, subject_name, href, created_at`
	var b Bookmark
	var ts time.Time
	if err := r.db.QueryRow(ctx, q, userID, kind, req.Title, req.SubjectName, req.Href).
		Scan(&b.ID, &b.Kind, &b.Title, &b.SubjectName, &b.Href, &ts); err != nil {
		return nil, err
	}
	b.Ts = iso(ts)
	return &b, nil
}

// DeleteBookmark removes a bookmark the caller owns. Ownership is enforced in the
// WHERE clause (a non-owner delete affects 0 rows → ErrNotFound).
func (r *Repository) DeleteBookmark(ctx context.Context, userID, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM public.academy_learner_bookmarks WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Notes ───────────────────────────────────────────────────────────────────

func (r *Repository) ListNotes(ctx context.Context, userID string) ([]Note, error) {
	const q = `
		SELECT id, lesson_id, lesson_title, subject_name, body, created_at
		FROM public.academy_learner_notes
		WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Note{}
	for rows.Next() {
		var n Note
		var ts time.Time
		if err := rows.Scan(&n.ID, &n.LessonID, &n.LessonTitle, &n.SubjectName, &n.Body, &ts); err != nil {
			return nil, err
		}
		n.Ts = iso(ts)
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *Repository) CreateNote(ctx context.Context, userID string, req CreateNoteRequest) (*Note, error) {
	const q = `
		INSERT INTO public.academy_learner_notes (user_id, lesson_id, lesson_title, subject_name, body)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, lesson_id, lesson_title, subject_name, body, created_at`
	var n Note
	var ts time.Time
	if err := r.db.QueryRow(ctx, q, userID, req.LessonID, req.LessonTitle, req.SubjectName, req.Body).
		Scan(&n.ID, &n.LessonID, &n.LessonTitle, &n.SubjectName, &n.Body, &ts); err != nil {
		return nil, err
	}
	n.Ts = iso(ts)
	return &n, nil
}

func (r *Repository) DeleteNote(ctx context.Context, userID, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM public.academy_learner_notes WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Notifications ───────────────────────────────────────────────────────────

func (r *Repository) ListNotifications(ctx context.Context, userID string) ([]Notification, error) {
	const q = `
		SELECT id, kind, title, body, COALESCE(href,''), read, created_at
		FROM public.academy_learner_notifications
		WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var n Notification
		var ts time.Time
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.Href, &n.Read, &ts); err != nil {
			return nil, err
		}
		n.Ts = iso(ts)
		out = append(out, n)
	}
	return out, rows.Err()
}

// MarkRead flips one notification the caller owns to read (no-op if not owned).
func (r *Repository) MarkRead(ctx context.Context, userID, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE public.academy_learner_notifications SET read = true WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// MarkAllRead flips all the caller's notifications to read.
func (r *Repository) MarkAllRead(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx, `UPDATE public.academy_learner_notifications SET read = true WHERE user_id = $1 AND read = false`, userID)
	return err
}

// ── Announcements ───────────────────────────────────────────────────────────

func (r *Repository) ListAnnouncements(ctx context.Context) ([]Announcement, error) {
	const q = `
		SELECT id, title, body, kind, COALESCE(sponsor,''), pinned, created_at
		FROM public.academy_announcements
		ORDER BY pinned DESC, created_at DESC LIMIT 50`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Announcement{}
	for rows.Next() {
		var a Announcement
		var ts time.Time
		if err := rows.Scan(&a.ID, &a.Title, &a.Body, &a.Kind, &a.Sponsor, &a.Pinned, &ts); err != nil {
			return nil, err
		}
		a.Ts = iso(ts)
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── Search (published curriculum only) ──────────────────────────────────────

// Search matches subjects/topics/lessons in the ACTIVE curriculum version by a
// case-insensitive substring. Question items are intentionally excluded (exam
// content must not leak through search). `like` is the caller-built ILIKE pattern.
func (r *Repository) Search(ctx context.Context, like string, limit int) ([]SearchResult, error) {
	const q = `
		SELECT id, kind, title, subtitle, href FROM (
			SELECT s.id::text AS id, 'subject' AS kind, s.name AS title, c.code AS subtitle,
			       '/learn/academy/subject/'||s.id::text AS href, s.name AS ord
			FROM public.academy_subjects s
			JOIN public.academy_classes c ON c.id = s.class_id
			JOIN public.academy_curriculum_versions v ON v.id = s.version_id AND v.status = 'active'
			WHERE s.name ILIKE $1
			UNION ALL
			SELECT t.id::text, 'topic', t.title, s.name,
			       '/learn/academy/topic/'||t.id::text, t.title
			FROM public.academy_topics t
			JOIN public.academy_subjects s ON s.id = t.subject_id
			JOIN public.academy_curriculum_versions v ON v.id = s.version_id AND v.status = 'active'
			WHERE t.title ILIKE $1
			UNION ALL
			SELECT l.id::text, 'lesson', l.title, s.name,
			       '/learn/academy/lesson/'||l.id::text, l.title
			FROM public.academy_edu_lessons l
			JOIN public.academy_learning_objectives o ON o.id = l.objective_id
			JOIN public.academy_topics t ON t.id = o.topic_id
			JOIN public.academy_subjects s ON s.id = t.subject_id
			JOIN public.academy_curriculum_versions v ON v.id = s.version_id AND v.status = 'active'
			WHERE l.title ILIKE $1
		) hits ORDER BY ord LIMIT $2`
	rows, err := r.db.Query(ctx, q, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SearchResult{}
	for rows.Next() {
		var s SearchResult
		if err := rows.Scan(&s.ID, &s.Kind, &s.Title, &s.Subtitle, &s.Href); err != nil {
			return nil, err
		}
		s.Icon = iconForKind(s.Kind)
		out = append(out, s)
	}
	return out, rows.Err()
}

func iconForKind(kind string) string {
	switch kind {
	case "subject":
		return "book"
	case "topic":
		return "layers"
	case "lesson":
		return "play-circle"
	default:
		return "search"
	}
}

// ── Daily goal inputs ───────────────────────────────────────────────────────

// StreakSummary reads the learner's streak + freezes from the gamification
// profile (0/0 when no profile exists yet).
func (r *Repository) StreakSummary(ctx context.Context, userID string) (streakDays, freezes int, err error) {
	const q = `SELECT streak_days, freezes FROM public.academy_gamification_profiles WHERE user_id = $1`
	err = r.db.QueryRow(ctx, q, userID).Scan(&streakDays, &freezes)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, 0, nil
	}
	return streakDays, freezes, err
}

// StudiedDates returns the set of yyyy-mm-dd (UTC) on which the learner logged any
// progress event within [since, now] — drives the calendar "studied" cells and
// today's activity count.
func (r *Repository) StudiedDates(ctx context.Context, userID string, since time.Time) (map[string]int, error) {
	const q = `
		SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)
		FROM public.academy_progress_events
		WHERE user_id = $1 AND created_at >= $2
		GROUP BY d`
	rows, err := r.db.Query(ctx, q, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var d string
		var n int
		if err := rows.Scan(&d, &n); err != nil {
			return nil, err
		}
		out[d] = n
	}
	return out, rows.Err()
}
