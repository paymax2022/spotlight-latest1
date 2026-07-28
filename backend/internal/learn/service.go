package learn

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor is the immutable-audit sink the learn module writes quiz submissions
// to (nil-safe). Mirrors the savings.Auditor shape used across finance modules.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service owns all Learn Center reads plus the single quiz-submission mutation.
// Content is server-driven config stored in learn_* tables (seeded by migration).
// Balances/money are NOT part of this module (education-only surface).
type Service struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service {
	return &Service{db: db, audit: audit}
}

// ───────────────────────── Paths ─────────────────────────

// ListPaths returns every published path with its ordered lesson ids and the
// caller's derived completion percentage (server-tracked from lesson progress).
func (s *Service) ListPaths(ctx context.Context, userID string) ([]LearnPath, error) {
	const q = `SELECT id, title, description, icon_color, level FROM learn_paths
	           WHERE published ORDER BY sort_order, title`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("learn: list paths: %w", err)
	}
	defer rows.Close()
	var paths []LearnPath
	for rows.Next() {
		var p LearnPath
		var level string
		if err := rows.Scan(&p.ID, &p.Title, &p.Description, &p.IconColor, &level); err != nil {
			return nil, err
		}
		p.Level = LearnLevel(level)
		paths = append(paths, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range paths {
		ids, err := s.lessonIDs(ctx, paths[i].ID)
		if err != nil {
			return nil, err
		}
		paths[i].LessonIDs = ids
		paths[i].ProgressPct = s.progress(ctx, userID, paths[i].ID, len(ids))
	}
	return paths, nil
}

// GetPath returns a single published path (or ErrNotFound).
func (s *Service) GetPath(ctx context.Context, userID, pathID string) (*LearnPath, error) {
	const q = `SELECT id, title, description, icon_color, level FROM learn_paths
	           WHERE id=$1 AND published`
	var p LearnPath
	var level string
	if err := s.db.QueryRow(ctx, q, pathID).Scan(&p.ID, &p.Title, &p.Description, &p.IconColor, &level); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("learn: get path: %w", err)
	}
	p.Level = LearnLevel(level)
	ids, err := s.lessonIDs(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.LessonIDs = ids
	p.ProgressPct = s.progress(ctx, userID, p.ID, len(ids))
	return &p, nil
}

func (s *Service) lessonIDs(ctx context.Context, pathID string) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT id FROM learn_lessons WHERE path_id=$1 ORDER BY sort_order, title`, pathID)
	if err != nil {
		return nil, fmt.Errorf("learn: lesson ids: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// progress returns the caller's completion pct for a path (0 when none / empty).
// Best-effort: a query error yields 0 so a broken progress read never blocks
// content delivery.
func (s *Service) progress(ctx context.Context, userID, pathID string, total int) int {
	if userID == "" || total == 0 {
		return 0
	}
	const q = `SELECT count(*) FROM learn_lesson_progress p
	           JOIN learn_lessons l ON l.id = p.lesson_id
	           WHERE p.user_id=$1 AND l.path_id=$2 AND p.completed`
	var done int
	if err := s.db.QueryRow(ctx, q, userID, pathID).Scan(&done); err != nil {
		return 0
	}
	return (done * 100) / total
}

// ───────────────────────── Lessons ─────────────────────────

// GetLesson returns a single lesson (or ErrNotFound). Reading a lesson marks it
// complete for the caller (idempotent) so path progress advances — this is the
// only side effect of the read and is best-effort (never fails the read).
func (s *Service) GetLesson(ctx context.Context, userID, lessonID string) (*Lesson, error) {
	const q = `SELECT id, path_id, title, duration_mins, kind, body, summary
	           FROM learn_lessons WHERE id=$1`
	var l Lesson
	var kind string
	if err := s.db.QueryRow(ctx, q, lessonID).Scan(&l.ID, &l.PathID, &l.Title, &l.DurationMins, &kind, &l.Body, &l.Summary); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("learn: get lesson: %w", err)
	}
	l.Kind = LessonKind(kind)
	s.markLessonRead(ctx, userID, lessonID)
	return &l, nil
}

func (s *Service) markLessonRead(ctx context.Context, userID, lessonID string) {
	if userID == "" {
		return
	}
	const ins = `INSERT INTO learn_lesson_progress (user_id, lesson_id, completed, completed_at)
	             VALUES ($1,$2,true,now())
	             ON CONFLICT (user_id, lesson_id) DO UPDATE SET completed=true, completed_at=now()`
	_, _ = s.db.Exec(ctx, ins, userID, lessonID)
}

// ───────────────────────── Quiz ─────────────────────────

// GetQuiz returns the quiz attached to a lesson, or ErrNotFound if the lesson
// has none. The answer key (is_correct) is NEVER serialised — every option's
// Correct field is forced false in the client-facing payload.
func (s *Service) GetQuiz(ctx context.Context, lessonID string) (*Quiz, error) {
	const qq = `SELECT id FROM learn_quizzes WHERE lesson_id=$1`
	var quizID string
	if err := s.db.QueryRow(ctx, qq, lessonID).Scan(&quizID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("learn: get quiz: %w", err)
	}
	return s.loadQuiz(ctx, quizID, false)
}

// loadQuiz assembles a quiz's questions + options. When withKey is false the
// per-option Correct flag is scrubbed (client-facing). withKey=true is used only
// internally by SubmitQuiz for authoritative scoring.
func (s *Service) loadQuiz(ctx context.Context, quizID string, withKey bool) (*Quiz, error) {
	var q Quiz
	if err := s.db.QueryRow(ctx, `SELECT id, lesson_id FROM learn_quizzes WHERE id=$1`, quizID).Scan(&q.ID, &q.LessonID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("learn: load quiz: %w", err)
	}
	rows, err := s.db.Query(ctx, `SELECT id, prompt FROM learn_quiz_questions WHERE quiz_id=$1 ORDER BY sort_order`, quizID)
	if err != nil {
		return nil, fmt.Errorf("learn: quiz questions: %w", err)
	}
	defer rows.Close()
	var questions []QuizQuestion
	for rows.Next() {
		var qq QuizQuestion
		if err := rows.Scan(&qq.ID, &qq.Prompt); err != nil {
			return nil, err
		}
		questions = append(questions, qq)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range questions {
		opts, err := s.options(ctx, questions[i].ID, withKey)
		if err != nil {
			return nil, err
		}
		questions[i].Options = opts
	}
	q.Questions = questions
	return &q, nil
}

func (s *Service) options(ctx context.Context, questionID string, withKey bool) ([]QuizOption, error) {
	rows, err := s.db.Query(ctx, `SELECT id, label, is_correct FROM learn_quiz_options WHERE question_id=$1 ORDER BY sort_order`, questionID)
	if err != nil {
		return nil, fmt.Errorf("learn: quiz options: %w", err)
	}
	defer rows.Close()
	var opts []QuizOption
	for rows.Next() {
		var o QuizOption
		if err := rows.Scan(&o.ID, &o.Label, &o.Correct); err != nil {
			return nil, err
		}
		if !withKey {
			o.Correct = false // scrub the answer key for the client
		}
		opts = append(opts, o)
	}
	return opts, rows.Err()
}

// SubmitQuiz scores a quiz submission server-side (authoritative). The client's
// answers never decide pass/fail — this loads the answer key, tallies correct
// answers, applies the server-held pass threshold, records the attempt, and
// audits it. Idempotent per (user, quiz) latest attempt is not required — each
// submission is a distinct attempt row.
func (s *Service) SubmitQuiz(ctx context.Context, userID, quizID string, answers QuizAnswers) (*QuizResult, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	quiz, err := s.loadQuiz(ctx, quizID, true) // withKey=true — authoritative scoring
	if err != nil {
		return nil, err
	}
	total := len(quiz.Questions)
	score := 0
	for _, qq := range quiz.Questions {
		chosen := answers[qq.ID]
		if chosen == "" {
			continue
		}
		for _, o := range qq.Options {
			if o.ID == chosen && o.Correct {
				score++
				break
			}
		}
	}
	passed := total > 0 && float64(score)/float64(total) >= QuizPassRatio
	// Record the attempt (append-only history of quiz results).
	const ins = `INSERT INTO learn_quiz_attempts (user_id, quiz_id, score, total, passed)
	             VALUES ($1,$2,$3,$4,$5)`
	if _, err := s.db.Exec(ctx, ins, userID, quizID, score, total, passed); err != nil {
		return nil, fmt.Errorf("learn: record attempt: %w", err)
	}
	s.log(userID, "learn.quiz.submit", "quiz", quizID, nil, map[string]any{
		"score": score, "total": total, "passed": passed,
	})
	return &QuizResult{Score: score, Total: total, Passed: passed}, nil
}

// ───────────────────────── Glossary ─────────────────────────

// Glossary returns every term alphabetically.
func (s *Service) Glossary(ctx context.Context) ([]GlossaryTerm, error) {
	rows, err := s.db.Query(ctx, `SELECT term, definition FROM learn_glossary ORDER BY term`)
	if err != nil {
		return nil, fmt.Errorf("learn: glossary: %w", err)
	}
	defer rows.Close()
	terms := []GlossaryTerm{}
	for rows.Next() {
		var t GlossaryTerm
		if err := rows.Scan(&t.Term, &t.Definition); err != nil {
			return nil, err
		}
		terms = append(terms, t)
	}
	return terms, rows.Err()
}

func (s *Service) log(actor, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "learn", resType, resID, oldV, newV, "", "", "info")
}
