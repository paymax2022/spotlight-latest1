package assessment

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service implements the assessment domain: question-bank admin + the learner
// progression engine. No money path.
type Service struct {
	repo       *Repository
	thresholds MasteryThresholds
	gamifier   Gamifier
}

// Gamifier is the engagement hook fired on a practice submission — the attempt
// awards XP and marks the day active for the streak. When nil (default) practice
// runs with no gamification side-effects. Best-effort: awarding never fails a
// submission. Wired to academy/gamification in academy_routes.go.
type Gamifier interface {
	AwardXP(ctx context.Context, userID, action string, amount int64) error
	ExtendStreak(ctx context.Context, userID string) error
}

// NewService wires the assessment service with the default thresholds.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(db), thresholds: DefaultThresholds()}
}

// WithThresholds overrides the progression thresholds (curriculum-as-data hook).
func (s *Service) WithThresholds(t MasteryThresholds) *Service {
	s.thresholds = t
	return s
}

// WithGamifier injects the engagement hook (gamification wiring). Nil-safe.
func (s *Service) WithGamifier(g Gamifier) *Service {
	s.gamifier = g
	return s
}

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIllegalTransition = errors.New("assessment: illegal state transition")
	ErrInvalidInput      = errors.New("assessment: invalid input")
	ErrNoItems           = errors.New("assessment: no approved items for objective")
)

// ── Question bank (admin) ───────────────────────────────────────────────────────

func (s *Service) CreateItem(ctx context.Context, actor string, req CreateItemRequest) (*QuestionItem, error) {
	if req.Stem == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertItem(ctx, actor, req)
}

func (s *Service) UpdateItem(ctx context.Context, actor, id string, req UpdateItemRequest) (*QuestionItem, error) {
	return s.repo.UpdateItem(ctx, actor, id, req)
}

// TransitionItem runs the guarded draft→review→approved→retired lifecycle.
func (s *Service) TransitionItem(ctx context.Context, actor, id string, to ItemStatus) (*QuestionItem, error) {
	if !validItemStatus(to) {
		return nil, ErrInvalidInput
	}
	return s.repo.TransitionItemStatus(ctx, actor, id, to)
}

func (s *Service) GetItem(ctx context.Context, id string) (*QuestionItem, error) {
	return s.repo.GetItem(ctx, id)
}

func (s *Service) ListItems(ctx context.Context, f ItemFilter) ([]QuestionItem, error) {
	return s.repo.ListItems(ctx, f)
}

func (s *Service) ItemAnalysis(ctx context.Context, f ItemFilter) ([]ItemAnalysis, error) {
	return s.repo.ItemAnalysis(ctx, f)
}

// ── Learner practice serving ────────────────────────────────────────────────────

// PracticeItems serves approved items for an objective. The handler strips the
// `answer` field before returning to the learner (answers stay server-side).
func (s *Service) PracticeItems(ctx context.Context, objectiveID string, limit int) ([]QuestionItem, error) {
	if objectiveID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.GetApprovedItemsForObjective(ctx, objectiveID, limit)
}

// ── Learner progression engine ──────────────────────────────────────────────────

// RecordPractice records a single practice attempt for an objective WITHOUT a
// mastery re-score. It bootstraps not_started→in_progress, otherwise just logs a
// practice_recorded event so the attempt counts toward the min-practice guard.
func (s *Service) RecordPractice(ctx context.Context, userID, objectiveID string) (*MasteryRecord, error) {
	if objectiveID == "" {
		return nil, ErrInvalidInput
	}
	cur, err := s.repo.GetMastery(ctx, userID, objectiveID)
	from := StateNotStarted
	if err == nil {
		from = cur.State
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	if from == StateNotStarted {
		// First touch: not_started → in_progress (guarded) + practice event.
		if !canProgress(from, StateInProgress) {
			return nil, ErrIllegalTransition
		}
		evtType := progressEventTypeFor(from, StateInProgress) // practice_recorded
		score := 0.0
		if cur != nil {
			score = cur.Score
		}
		return s.repo.ApplyProgression(ctx, userID, objectiveID, from, StateInProgress, score,
			evtType, map[string]any{"reason": "first_practice"})
	}

	// Already in progress (or further): just log the practice attempt for the guard.
	if err := s.repo.RecordPracticeEvent(ctx, userID, objectiveID, map[string]any{"reason": "practice"}); err != nil {
		return nil, err
	}
	return cur, nil
}

// RunMasteryCheck scores the learner's answers against the approved item answers,
// upserts the mastery record through the guarded progression machine, and writes a
// ProgressEvent on any upgrade. Returns the practice result.
//
// answers maps question_item_id → selected. The score is the fraction correct.
func (s *Service) RunMasteryCheck(ctx context.Context, userID, objectiveID string, answers []PracticeAnswer, examTagged bool) (*PracticeResult, error) {
	if objectiveID == "" || len(answers) == 0 {
		return nil, ErrInvalidInput
	}

	// Score server-side against the canonical answers, collecting a per-question
	// review for the learner's post-submission feedback.
	correct := 0
	breakdown := make([]PracticeReview, 0, len(answers))
	for _, a := range answers {
		item, err := s.repo.GetItem(ctx, a.QuestionItemID)
		if err != nil {
			// Unknown item id is an invalid submission, fail closed on that item.
			breakdown = append(breakdown, PracticeReview{QuestionItemID: a.QuestionItemID, Correct: false})
			continue
		}
		ok := isCorrect(item.Answer, a.Selected)
		if ok {
			correct++
		}
		expl, _ := item.Answer["explanation"].(string)
		breakdown = append(breakdown, PracticeReview{
			QuestionItemID: a.QuestionItemID,
			Stem:           item.Stem,
			Correct:        ok,
			CorrectAnswer:  item.Answer["correct"],
			Explanation:    expl,
		})
	}
	scored := len(answers)
	score := 0.0
	if scored > 0 {
		score = float64(correct) / float64(scored)
	}

	// Current state + accumulated practice attempts feed the guards.
	cur, err := s.repo.GetMastery(ctx, userID, objectiveID)
	from := StateNotStarted
	if err == nil {
		from = cur.State
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	attempts, err := s.repo.CountPracticeAttempts(ctx, userID, objectiveID)
	if err != nil {
		return nil, err
	}
	attempts++ // count this submission as a practice attempt

	to := nextStateForPractice(from, attempts, score, s.thresholds, examTagged)

	// Validate against the pure guard (defence in depth; repo re-checks under lock).
	if !canProgress(from, to) {
		return nil, ErrIllegalTransition
	}

	evtType := progressEventTypeFor(from, to)
	if evtType == "" {
		// No state change this submission, but it is still a practice attempt —
		// log it as practice_recorded so it counts toward the min-practice-attempts
		// guard (CountPracticeAttempts). Without this, in_progress → practiced is
		// unreachable: the count never grows past the first bootstrap event and the
		// mastery ladder dead-ends. Mirrors the standalone RecordPractice path.
		evtType = EvtPracticeRecorded
	}
	if _, err := s.repo.ApplyProgression(ctx, userID, objectiveID, from, to, score, evtType,
		map[string]any{"score": score, "correct": correct, "scored": scored, "attempts": attempts}); err != nil {
		return nil, err
	}

	// Engagement: a completed practice set awards XP (10 per correct answer) and
	// marks the day active for the streak. Best-effort — a gamification hiccup
	// never fails the (already-persisted) progression.
	if s.gamifier != nil {
		_ = s.gamifier.AwardXP(ctx, userID, "practice_completed", int64(correct*10))
		_ = s.gamifier.ExtendStreak(ctx, userID)
	}

	return &PracticeResult{
		ObjectiveID: objectiveID,
		Scored:      scored,
		Correct:     correct,
		Score:       score,
		FromState:   from,
		ToState:     to,
		Upgraded:    from != to,
		Breakdown:   breakdown,
	}, nil
}

func (s *Service) ListMastery(ctx context.Context, userID string) ([]MasteryRecord, error) {
	return s.repo.ListMastery(ctx, userID)
}

func (s *Service) ListProgress(ctx context.Context, userID string, limit int) ([]ProgressEvent, error) {
	return s.repo.ListProgress(ctx, userID, limit)
}

// isCorrect compares a learner's selected answer with the item's canonical answer.
// MCQ convention: answer = {"correct": <value>} and selected = {"value": <value>}
// (or {"correct": <value>}). Comparison is on the "correct"/"value" keys; falls
// back to deep-equality of the whole maps.
func isCorrect(answer, selected map[string]any) bool {
	if answer == nil || selected == nil {
		return false
	}
	want, hasWant := answer["correct"]
	if !hasWant {
		return false
	}
	if got, ok := selected["value"]; ok {
		return equalAny(want, got)
	}
	if got, ok := selected["correct"]; ok {
		return equalAny(want, got)
	}
	if got, ok := selected["selected"]; ok {
		return equalAny(want, got)
	}
	return false
}

func equalAny(a, b any) bool {
	// JSON numbers decode as float64; normalise for robust comparison.
	return normalize(a) == normalize(b)
}

func normalize(v any) string {
	if v == nil {
		return ""
	}
	// fmt with %v gives a stable scalar string for strings/bools/numbers; JSON
	// numbers arrive as float64 so 2 and 2.0 normalise identically.
	switch t := v.(type) {
	case float64:
		// Drop a trailing ".0" so "2" (int-like) and 2.0 compare equal.
		return fmt.Sprintf("%g", t)
	default:
		return fmt.Sprintf("%v", t)
	}
}
