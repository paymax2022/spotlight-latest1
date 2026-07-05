package progression

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service implements the adaptive-progression domain: learning-path build/read,
// guarded step advancement driven by REUSED mastery records, adaptive practice
// selection and next-best recommendations. No money path.
type Service struct {
	repo *Repository
}

// NewService wires the progression service from the pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{repo: NewRepository(db)} }

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIllegalTransition = errors.New("progression: illegal state transition")
	ErrInvalidInput      = errors.New("progression: invalid input")
	ErrNoObjectives      = errors.New("progression: subject has no objectives")
	ErrNotMastered       = errors.New("progression: objective not yet mastered")
)

// masteryThreshold resolves the active mastery threshold from adaptive_config,
// falling back to DefaultMasteryThreshold. Curriculum-as-data: the threshold is a
// config row, never a constant in the transition code.
func (s *Service) masteryThreshold(ctx context.Context) float64 {
	cfg, err := s.repo.GetConfig(ctx, CfgMasteryThreshold)
	if err != nil || cfg == nil {
		return DefaultMasteryThreshold
	}
	if v, ok := cfg.Value["value"]; ok {
		if f, ok := v.(float64); ok && f > 0 {
			return f
		}
	}
	if v, ok := cfg.Value["threshold"]; ok {
		if f, ok := v.(float64); ok && f > 0 {
			return f
		}
	}
	return DefaultMasteryThreshold
}

// ── Path build / read ───────────────────────────────────────────────────────────

// BuildPath creates a learning path for (user, subject) from the subject's ordered
// curriculum objectives. The first step is 'available', the rest 'locked'.
// Idempotent: a UNIQUE (user_id, subject_id) means a re-call returns the existing
// path untouched. Objective ORDER comes from the curriculum (topic ordinal then
// objective ordinal) — never hardcoded.
func (s *Service) BuildPath(ctx context.Context, actor, userID, subjectID string, classID *string) (*LearningPath, error) {
	if subjectID == "" {
		return nil, ErrInvalidInput
	}
	objectives, err := s.repo.ObjectivesForSubject(ctx, subjectID)
	if err != nil {
		return nil, err
	}
	if len(objectives) == 0 {
		return nil, ErrNoObjectives
	}
	if _, err := s.repo.CreatePathWithSteps(ctx, actor, userID, subjectID, classID, objectives); err != nil {
		return nil, err
	}
	return s.GetPath(ctx, userID, subjectID)
}

// GetPath returns the path with its steps, each merged with the learner's mastery
// state/score read from academy_mastery_records (read-only reuse).
func (s *Service) GetPath(ctx context.Context, userID, subjectID string) (*LearningPath, error) {
	path, err := s.repo.GetPath(ctx, userID, subjectID)
	if err != nil {
		return nil, err
	}
	steps, err := s.repo.ListSteps(ctx, path.ID)
	if err != nil {
		return nil, err
	}
	// Merge mastery (single lookup of the learner's records).
	masteries, err := s.repo.ListMastery(ctx, userID)
	if err != nil {
		return nil, err
	}
	byObj := make(map[string]Mastery, len(masteries))
	for _, m := range masteries {
		byObj[m.ObjectiveID] = m
	}
	for i := range steps {
		if m, ok := byObj[steps[i].ObjectiveID]; ok {
			steps[i].MasteryState = m.State
			steps[i].MasteryScore = m.Score
		} else {
			steps[i].MasteryState = "not_started"
		}
	}
	path.Steps = steps
	return path, nil
}

// AdvanceStep moves a path step to done when the learner has MASTERED its
// objective, then unlocks the next step — all guarded. Mastery is the canonical
// academy_mastery_records.state (reused; we read, never write it). The objective
// must belong to one of the learner's active paths.
func (s *Service) AdvanceStep(ctx context.Context, actor, userID, objectiveID string) (*PathStep, error) {
	if objectiveID == "" {
		return nil, ErrInvalidInput
	}
	// Mastery gate: only a 'mastered' (or 'exam_ready') objective may complete its step.
	m, err := s.repo.GetMastery(ctx, userID, objectiveID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrNotMastered
		}
		return nil, err
	}
	if m.State != masteredState && m.State != examReadyState {
		return nil, ErrNotMastered
	}

	// Locate the step (across the learner's paths) by objective. We need the path id;
	// resolve it via the step row itself.
	pathID, from, err := s.repo.resolveStep(ctx, userID, objectiveID)
	if err != nil {
		return nil, err
	}

	// Bring the step forward to in_progress first if it is only 'available', so the
	// machine progresses through legal single steps. locked steps cannot be advanced.
	switch from {
	case StepLocked:
		return nil, ErrIllegalTransition
	case StepAvailable:
		if _, err := s.repo.UpdatePathStepState(ctx, actor, userID, pathID, objectiveID, StepAvailable, StepInProgress); err != nil {
			return nil, err
		}
		from = StepInProgress
	case StepDone:
		// Already done — idempotent success.
		return s.repo.GetStepByObjective(ctx, pathID, objectiveID)
	}
	// in_progress → done (guarded), which also unlocks the next step + emits events.
	return s.repo.UpdatePathStepState(ctx, actor, userID, pathID, objectiveID, from, StepDone)
}

// StartStep transitions an available step to in_progress (learner opened the
// objective). Guarded; emits a step_started event.
func (s *Service) StartStep(ctx context.Context, actor, userID, objectiveID string) (*PathStep, error) {
	if objectiveID == "" {
		return nil, ErrInvalidInput
	}
	pathID, from, err := s.repo.resolveStep(ctx, userID, objectiveID)
	if err != nil {
		return nil, err
	}
	return s.repo.UpdatePathStepState(ctx, actor, userID, pathID, objectiveID, from, StepInProgress)
}

// ── Adaptive practice ───────────────────────────────────────────────────────────

// AdaptivePractice selects the learner's WEAK objectives (mastery below threshold
// or not yet started/in progress), picks difficulty-spread question items for them
// and creates a practice session. Either an explicit objective set OR a subject is
// supplied; objective_ids takes precedence. Selection uses the PURE helpers
// selectWeakObjectives + pickItems so the math is unit-tested without a DB.
func (s *Service) AdaptivePractice(ctx context.Context, userID, subjectID string, objectiveIDs []string, limit int) (*PracticeSession, error) {
	threshold := s.masteryThreshold(ctx)

	// Determine the candidate objective universe.
	var universe []string
	if len(objectiveIDs) > 0 {
		universe = objectiveIDs
	} else if subjectID != "" {
		objs, err := s.repo.ObjectivesForSubject(ctx, subjectID)
		if err != nil {
			return nil, err
		}
		for _, o := range objs {
			universe = append(universe, o.ObjectiveID)
		}
	} else {
		return nil, ErrInvalidInput
	}
	if len(universe) == 0 {
		return nil, ErrNoObjectives
	}

	// Read the learner's mastery rows and seed missing objectives as not_started so
	// never-touched objectives surface as weak.
	masteryRows, err := s.repo.ListMastery(ctx, userID)
	if err != nil {
		return nil, err
	}
	have := make(map[string]Mastery, len(masteryRows))
	for _, m := range masteryRows {
		have[m.ObjectiveID] = m
	}
	seeded := make([]Mastery, 0, len(universe))
	for _, id := range universe {
		if m, ok := have[id]; ok {
			seeded = append(seeded, m)
		} else {
			seeded = append(seeded, Mastery{ObjectiveID: id, State: "not_started", Score: 0})
		}
	}

	weak := selectWeakObjectives(seeded, threshold)
	if len(weak) == 0 {
		// Nothing weak — fall back to the whole universe so practice is never empty.
		weak = universe
	}

	items, err := s.repo.ApprovedItemsForObjectives(ctx, weak)
	if err != nil {
		return nil, err
	}
	picked := pickItems(items, weak, limit)

	sess, err := s.repo.InsertPracticeSession(ctx, userID, "adaptive", weak)
	if err != nil {
		return nil, err
	}
	sess.ItemIDs = picked
	return sess, nil
}

// CompletePractice finalises a practice session with a score (0..1). Mastery
// itself is updated by the assessment package's RunMasteryCheck on submit; here we
// only close the session record.
func (s *Service) CompletePractice(ctx context.Context, userID, sessionID string, score float64) (*PracticeSession, error) {
	if sessionID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.CompletePracticeSession(ctx, userID, sessionID, score)
}

// ── Recommendations ─────────────────────────────────────────────────────────────

// Recommendations recomputes next-best objectives from the learner's mastery gaps,
// boosting objectives that are the current available/in_progress frontier across
// their paths. Persists (full replace) and returns the ranked set.
func (s *Service) Recommendations(ctx context.Context, userID string) ([]Recommendation, error) {
	threshold := s.masteryThreshold(ctx)

	masteryRows, err := s.repo.ListMastery(ctx, userID)
	if err != nil {
		return nil, err
	}
	byObj := make(map[string]Mastery, len(masteryRows))
	for _, m := range masteryRows {
		byObj[m.ObjectiveID] = m
	}

	// Frontier objectives = available/in_progress path steps across the learner's
	// paths (the curriculum spine that should drive momentum).
	frontier, err := s.repo.frontierObjectives(ctx, userID)
	if err != nil {
		return nil, err
	}
	onPath := make(map[string]bool, len(frontier))
	for _, id := range frontier {
		onPath[id] = true
	}

	// Candidate set = mastery rows that are weak ∪ frontier objectives.
	candidates := make(map[string]Mastery)
	for _, m := range masteryRows {
		if isWeak(m, threshold) {
			candidates[m.ObjectiveID] = m
		}
	}
	for _, id := range frontier {
		if _, ok := candidates[id]; !ok {
			if m, ok := byObj[id]; ok {
				candidates[id] = m
			} else {
				candidates[id] = Mastery{ObjectiveID: id, State: "not_started", Score: 0}
			}
		}
	}

	recos := make([]Recommendation, 0, len(candidates))
	for id, m := range candidates {
		objID := id
		score := recommendationScore(m, threshold, onPath[id])
		if score <= 0 {
			continue
		}
		reason := "mastery_gap"
		if onPath[id] {
			reason = "path_frontier"
		}
		recos = append(recos, Recommendation{UserID: userID, ObjectiveID: &objID, Reason: reason, Score: score})
	}

	return s.repo.ReplaceRecommendations(ctx, userID, recos)
}

// ── Admin: adaptive config ──────────────────────────────────────────────────────

func (s *Service) ListAdaptiveConfig(ctx context.Context) ([]AdaptiveConfig, error) {
	return s.repo.ListConfig(ctx)
}

func (s *Service) GetAdaptiveConfig(ctx context.Context, key string) (*AdaptiveConfig, error) {
	if key == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.GetConfig(ctx, key)
}

func (s *Service) UpsertAdaptiveConfig(ctx context.Context, actor, key string, value map[string]any) (*AdaptiveConfig, error) {
	if key == "" || value == nil {
		return nil, ErrInvalidInput
	}
	return s.repo.UpsertConfig(ctx, actor, key, value)
}
