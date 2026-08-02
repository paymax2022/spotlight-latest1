package exam

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service implements the exam-arena + CBT domain: arena/blueprint/combination admin
// config + the guarded, server-authoritative CBT attempt engine. No money path —
// entitlement is checked via the injected EntitlementChecker (commerce wires later).
type Service struct {
	repo        *Repository
	entitlement EntitlementChecker
	gamifier    Gamifier
	now         func() time.Time // injectable clock for deadline tests
}

// EntitlementChecker decides whether a user may begin an attempt on an arena.
// Commerce injects the real implementation later; when nil the service is
// DEFAULT-ALLOW (Phase-1 free arenas / dev).
type EntitlementChecker interface {
	HasAccess(ctx context.Context, userID, arenaID string) (bool, error)
}

// Gamifier is the engagement hook fired on a scored submission — the completion
// awards XP and marks the day active for the streak. When nil (default) the exam
// runs with no gamification side-effects. Best-effort: awarding never fails a
// submit. Wired to academy/gamification in academy_routes.go.
type Gamifier interface {
	AwardXP(ctx context.Context, userID, action string, amount int64) error
	ExtendStreak(ctx context.Context, userID string) error
}

// NewService wires the exam service with a system clock and no entitlement checker
// (default-allow until commerce injects one).
func NewService(db *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(db), now: time.Now}
}

// WithGamifier injects the engagement hook (gamification wiring). Nil-safe.
func (s *Service) WithGamifier(g Gamifier) *Service {
	s.gamifier = g
	return s
}

// WithEntitlement injects the entitlement checker (commerce wiring hook).
func (s *Service) WithEntitlement(e EntitlementChecker) *Service {
	s.entitlement = e
	return s
}

// WithClock overrides the clock (deadline/late tests).
func (s *Service) WithClock(now func() time.Time) *Service {
	s.now = now
	return s
}

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIllegalTransition = errors.New("exam: illegal state transition")
	ErrInvalidInput      = errors.New("exam: invalid input")
	ErrNotEntitled       = errors.New("exam: not entitled to this arena")
	ErrPauseNotAllowed   = errors.New("exam: blueprint does not permit pausing")
	ErrAlreadyFinal      = errors.New("exam: attempt already submitted")
)

// ── Arena / blueprint / combination admin ───────────────────────────────────────

func (s *Service) CreateArena(ctx context.Context, actor string, req CreateArenaRequest) (*Arena, error) {
	if req.Code == "" || req.Name == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertArena(ctx, actor, req)
}

func (s *Service) UpdateArena(ctx context.Context, actor, id string, req UpdateArenaRequest) (*Arena, error) {
	return s.repo.UpdateArena(ctx, actor, id, req)
}

func (s *Service) GetArena(ctx context.Context, id string) (*Arena, error) {
	return s.repo.GetArena(ctx, id)
}

func (s *Service) ListArenas(ctx context.Context) ([]Arena, error) {
	return s.repo.ListArenas(ctx)
}

func (s *Service) CreateBlueprint(ctx context.Context, actor, arenaID string, req CreateBlueprintRequest) (*CBTBlueprint, error) {
	if req.Name == "" || req.TotalSeconds <= 0 {
		return nil, ErrInvalidInput
	}
	if _, err := s.repo.GetArena(ctx, arenaID); err != nil {
		return nil, err
	}
	return s.repo.InsertBlueprint(ctx, actor, arenaID, req)
}

func (s *Service) UpdateBlueprint(ctx context.Context, actor, id string, req UpdateBlueprintRequest) (*CBTBlueprint, error) {
	return s.repo.UpdateBlueprint(ctx, actor, id, req)
}

func (s *Service) ListBlueprints(ctx context.Context, arenaID string) ([]CBTBlueprint, error) {
	return s.repo.ListBlueprintsForArena(ctx, arenaID)
}

func (s *Service) CreateCombination(ctx context.Context, actor string, req CombinationRequest) (*SubjectCombinationRule, error) {
	if req.ArenaID == "" || req.Course == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertCombination(ctx, actor, req)
}

func (s *Service) UpdateCombination(ctx context.Context, actor, id string, req CombinationRequest) (*SubjectCombinationRule, error) {
	return s.repo.UpdateCombination(ctx, actor, id, req)
}

func (s *Service) DeleteCombination(ctx context.Context, actor, id string) error {
	return s.repo.DeleteCombination(ctx, actor, id)
}

// GetCombinations returns the UTME (or any arena) course→subject-set rules.
func (s *Service) GetCombinations(ctx context.Context, arenaID, course string) ([]SubjectCombinationRule, error) {
	return s.repo.GetCombinations(ctx, arenaID, course)
}

// ── CBT attempt engine ───────────────────────────────────────────────────────────

// Begin runs created→started: entitlement check, then create a started attempt with
// a SERVER-AUTHORITATIVE deadline = now + blueprint.total_seconds. Idempotent on
// idemKey: a reused key returns the existing attempt rather than creating a new one.
func (s *Service) Begin(ctx context.Context, userID, blueprintID string, offlineOrigin bool, idemKey string) (*Attempt, error) {
	if userID == "" || blueprintID == "" {
		return nil, ErrInvalidInput
	}

	// Idempotency: reused key → return the existing attempt.
	if idemKey != "" {
		if existing, err := s.repo.GetAttemptByIdempotencyKey(ctx, idemKey); err == nil {
			return existing, nil
		} else if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}

	bp, err := s.repo.GetBlueprint(ctx, blueprintID)
	if err != nil {
		return nil, err
	}

	// Entitlement (default-allow when no checker is wired).
	if s.entitlement != nil {
		ok, err := s.entitlement.HasAccess(ctx, userID, bp.ArenaID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrNotEntitled
		}
	}

	started := s.now().UTC()
	// Server-authoritative timer: deadline is fixed at begin; client countdown is cosmetic.
	deadline := started.Add(time.Duration(bp.TotalSeconds) * time.Second)
	arenaID := bp.ArenaID
	var idemArg *string
	if idemKey != "" {
		idemArg = &idemKey
	}
	return s.repo.CreateAttempt(ctx, userID, blueprintID, &arenaID, started, deadline, offlineOrigin, idemArg)
}

// AttemptQuestions returns the question set for an attempt the caller owns,
// composed from the blueprint's sections ([{subject_id, count}]) and served
// WITHOUT the answer key. The set is deterministic per blueprint (repo orders by
// id), so pause/resume/re-fetch yield a stable set; grading remains server-side.
func (s *Service) AttemptQuestions(ctx context.Context, userID, attemptID string) ([]ServedQuestion, error) {
	att, err := s.ownedAttempt(ctx, userID, attemptID)
	if err != nil {
		return nil, err
	}
	bp, err := s.repo.GetBlueprint(ctx, att.BlueprintID)
	if err != nil {
		return nil, err
	}
	out := []ServedQuestion{}
	for _, sec := range bp.Sections {
		m, ok := sec.(map[string]any)
		if !ok {
			continue
		}
		subjectID, _ := m["subject_id"].(string)
		count := sectionCount(m["count"])
		if subjectID == "" || count <= 0 {
			continue
		}
		qs, err := s.repo.SelectApprovedQuestions(ctx, subjectID, count)
		if err != nil {
			return nil, err
		}
		out = append(out, qs...)
	}
	return out, nil
}

// GetAttemptResult returns the stored score/readiness/predicted projection for a
// submitted/scored attempt the caller owns. 404 until the attempt is submitted.
func (s *Service) GetAttemptResult(ctx context.Context, userID, attemptID string) (map[string]any, error) {
	att, err := s.ownedAttempt(ctx, userID, attemptID)
	if err != nil {
		return nil, err
	}
	switch att.State {
	case AttemptSubmitted, AttemptScored, AttemptReviewed:
		// result is available
	default:
		return nil, ErrNotFound // not yet submitted → no result projection
	}
	res := map[string]any{}
	for k, v := range att.Score { // subjects, overall, grade, late
		res[k] = v
	}
	if att.Readiness != nil {
		res["readiness"] = *att.Readiness
	}
	if att.Predicted != nil {
		res["predicted"] = att.Predicted
	}
	return res, nil
}

// sectionCount coerces a jsonb section count (float64 from JSON, or int/string)
// into an int; unparseable → 0.
func sectionCount(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}

// Pause runs started→paused (only if the blueprint's pause_policy = allowed).
func (s *Service) Pause(ctx context.Context, userID, attemptID string) (*Attempt, error) {
	att, err := s.ownedAttempt(ctx, userID, attemptID)
	if err != nil {
		return nil, err
	}
	bp, err := s.repo.GetBlueprint(ctx, att.BlueprintID)
	if err != nil {
		return nil, err
	}
	if bp.PausePolicy != PauseAllowed {
		return nil, ErrPauseNotAllowed
	}
	if !canAttempt(att.State, AttemptPaused) {
		return nil, fmt.Errorf("%w: %s -> paused", ErrIllegalTransition, att.State)
	}
	updated, _, err := s.repo.UpdateAttemptState(ctx, userID, attemptID, att.State, AttemptPaused,
		map[string]any{"paused_at": s.now().UTC()})
	return updated, err
}

// Resume runs paused→started. The server_deadline is NOT extended — pause does not
// stop the authoritative clock (timing is server-authoritative).
func (s *Service) Resume(ctx context.Context, userID, attemptID string) (*Attempt, error) {
	att, err := s.ownedAttempt(ctx, userID, attemptID)
	if err != nil {
		return nil, err
	}
	bp, err := s.repo.GetBlueprint(ctx, att.BlueprintID)
	if err != nil {
		return nil, err
	}
	if bp.PausePolicy != PauseAllowed {
		return nil, ErrPauseNotAllowed
	}
	if !canAttempt(att.State, AttemptStarted) {
		return nil, fmt.Errorf("%w: %s -> started", ErrIllegalTransition, att.State)
	}
	updated, _, err := s.repo.UpdateAttemptState(ctx, userID, attemptID, att.State, AttemptStarted, nil)
	return updated, err
}

// Submit runs started/paused→submitted then score→scored. IDEMPOTENT: if the
// attempt is already submitted/scored/reviewed, the existing scored attempt is
// returned without re-freezing. Responses are frozen (immutable) on first submit.
// Submissions after server_deadline are still accepted but marked late (integrity).
func (s *Service) Submit(ctx context.Context, userID, attemptID string, responses []ResponseInput, integrity map[string]any, idemKey string) (*Attempt, error) {
	att, err := s.ownedAttempt(ctx, userID, attemptID)
	if err != nil {
		return nil, err
	}

	// Idempotent replay: already final → return as-is (responses already frozen).
	if isTerminalForResponses(att.State) {
		return att, nil
	}

	if !canAttempt(att.State, AttemptSubmitted) {
		return nil, fmt.Errorf("%w: %s -> submitted", ErrIllegalTransition, att.State)
	}

	now := s.now().UTC()
	late := false
	if att.ServerDeadline != nil && now.After(*att.ServerDeadline) {
		late = true // accept but mark late — integrity signal, not punitive
	}

	if integrity == nil {
		integrity = map[string]any{}
	}
	integrity["late"] = late
	integrity["submitted_at"] = now.Format(time.RFC3339)
	if att.OfflineOrigin {
		integrity["offline_reconciled"] = true
	}

	// Score server-side against canonical answers BEFORE freezing.
	res, correctByID, err := s.scoreAttempt(ctx, att, responses, late)
	if err != nil {
		return nil, err
	}

	// Freeze responses (immutable) — only if not already written (idempotency belt-and-braces).
	existing, err := s.repo.CountResponses(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	if existing == 0 {
		if err := s.repo.InsertResponses(ctx, attemptID, responses, correctByID); err != nil {
			return nil, err
		}
	}

	// started/paused → submitted (guarded; freezes state).
	_, moved, err := s.repo.UpdateAttemptState(ctx, userID, attemptID, att.State, AttemptSubmitted,
		map[string]any{"submitted_at": now, "integrity": integrity})
	if err != nil {
		return nil, err
	}
	if !moved {
		// Concurrent submit already finalised it — return current (idempotent).
		return s.repo.GetAttempt(ctx, attemptID)
	}

	// submitted → scored (persist score/readiness/predicted).
	scoreMap := resultToScoreMap(res)
	_, _, err = s.repo.UpdateAttemptState(ctx, userID, attemptID, AttemptSubmitted, AttemptScored,
		map[string]any{
			"score":     scoreMap,
			"readiness": res.Readiness,
			"predicted": res.Predicted,
		})
	if err != nil {
		return nil, err
	}

	// Engagement: a completed exam awards XP (= overall score) and marks the day
	// active for the streak. Best-effort — a gamification hiccup never fails the
	// (already-persisted) submit, and this only runs on the first scoring pass.
	if s.gamifier != nil {
		_ = s.gamifier.AwardXP(ctx, userID, "exam_completed", int64(res.Overall))
		_ = s.gamifier.ExtendStreak(ctx, userID)
	}
	return s.repo.GetAttempt(ctx, attemptID)
}

// Score (re)computes and persists the score for a submitted attempt. Exposed for
// re-scoring; Submit calls the same scoring core inline.
func (s *Service) Score(ctx context.Context, userID, attemptID string) (*Attempt, error) {
	att, err := s.ownedAttempt(ctx, userID, attemptID)
	if err != nil {
		return nil, err
	}
	if att.State != AttemptSubmitted {
		return nil, fmt.Errorf("%w: %s -> scored", ErrIllegalTransition, att.State)
	}
	resps, err := s.repo.GetResponses(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	inputs := make([]ResponseInput, 0, len(resps))
	for _, r := range resps {
		inputs = append(inputs, ResponseInput{QuestionItemID: r.QuestionItemID, Selected: r.Selected, TimeMS: r.TimeMS, Flagged: r.Flagged})
	}
	late, _ := att.Integrity["late"].(bool)
	res, _, err := s.scoreAttempt(ctx, att, inputs, late)
	if err != nil {
		return nil, err
	}
	_, _, err = s.repo.UpdateAttemptState(ctx, userID, attemptID, AttemptSubmitted, AttemptScored,
		map[string]any{"score": resultToScoreMap(res), "readiness": res.Readiness, "predicted": res.Predicted})
	if err != nil {
		return nil, err
	}
	return s.repo.GetAttempt(ctx, attemptID)
}

// Review runs scored→reviewed and returns the per-question breakdown. Integrity
// signals are surfaced for moderation/analytics (logged, not punitive).
func (s *Service) Review(ctx context.Context, userID, attemptID string) (*Attempt, []Response, error) {
	att, err := s.ownedAttempt(ctx, userID, attemptID)
	if err != nil {
		return nil, nil, err
	}
	if att.State == AttemptReviewed {
		// Idempotent: already reviewed → return breakdown.
		resps, rerr := s.repo.GetResponses(ctx, attemptID)
		return att, resps, rerr
	}
	if !canAttempt(att.State, AttemptReviewed) {
		return nil, nil, fmt.Errorf("%w: %s -> reviewed", ErrIllegalTransition, att.State)
	}
	updated, _, err := s.repo.UpdateAttemptState(ctx, userID, attemptID, att.State, AttemptReviewed, nil)
	if err != nil {
		return nil, nil, err
	}
	resps, err := s.repo.GetResponses(ctx, attemptID)
	return updated, resps, err
}

// GetAttempt returns an attempt the user owns.
func (s *Service) GetAttempt(ctx context.Context, userID, attemptID string) (*Attempt, error) {
	return s.ownedAttempt(ctx, userID, attemptID)
}

// ownedAttempt loads the attempt and enforces ownership (defence in depth on RLS).
func (s *Service) ownedAttempt(ctx context.Context, userID, attemptID string) (*Attempt, error) {
	att, err := s.repo.GetAttempt(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	if att.UserID != userID {
		return nil, ErrNotFound // do not leak existence
	}
	return att, nil
}

// scoreAttempt is the impure wrapper: it fetches canonical answers + subject ids,
// computes correctness, then delegates the pure math to score(). It returns the
// Result and a per-question correctness map (for freezing into academy_responses).
func (s *Service) scoreAttempt(ctx context.Context, att *Attempt, responses []ResponseInput, late bool) (Result, map[string]bool, error) {
	ids := make([]string, 0, len(responses))
	for _, r := range responses {
		ids = append(ids, r.QuestionItemID)
	}
	answers, subjects, err := s.repo.GetQuestionAnswers(ctx, ids)
	if err != nil {
		return Result{}, nil, err
	}

	// Per-question correctness.
	correctByID := map[string]bool{}
	for _, r := range responses {
		correctByID[r.QuestionItemID] = isCorrect(answers[r.QuestionItemID], r.Selected)
	}

	// Arena scoring rules drive scale/grade-band.
	var rules map[string]any
	if att.ArenaID != nil {
		if arena, aerr := s.repo.GetArena(ctx, *att.ArenaID); aerr == nil {
			rules = arena.ScoringRules
		}
	}

	// Mastery factor for readiness.
	mastered, totalObj, merr := s.repo.CountMasteredForUser(ctx, att.UserID)
	if merr != nil {
		// Readiness degrades to mock-only when mastery is unavailable.
		mastered, totalObj = 0, 0
	}

	res := score(rules, responses, correctByID, subjects, mastered, totalObj)
	res.Late = late
	return res, correctByID, nil
}

// ── Pure scoring core ────────────────────────────────────────────────────────────

// score is the PURE scoring + readiness function. No DB, no ctx → unit-testable.
//
//   - Per-subject raw = correct count; total = items in subject.
//   - Overall: when scoring_rules.scale == "400" (UTME/JAMB), overall is mapped onto
//     the 400-point scale (fraction-correct × 400). Otherwise grade-band scoring:
//     each subject gets a letter grade from scoring_rules.bands (or the WASSCE
//     default) and overall is the average percentage.
//   - Readiness = coverage × mastery × mock (all 0..1). If no mastery data exists
//     (totalObj == 0), readiness falls back to MOCK-ONLY (the mock fraction).
func score(rules map[string]any, responses []ResponseInput, correctByID map[string]bool, subjects map[string]string, mastered, totalObj int) Result {
	// Aggregate per subject. Unknown subject → "general".
	type agg struct{ raw, total int }
	perSubject := map[string]*agg{}
	totalCorrect, totalItems := 0, 0
	for _, r := range responses {
		subj := subjects[r.QuestionItemID]
		if subj == "" {
			subj = "general"
		}
		a := perSubject[subj]
		if a == nil {
			a = &agg{}
			perSubject[subj] = a
		}
		a.total++
		totalItems++
		if correctByID[r.QuestionItemID] {
			a.raw++
			totalCorrect++
		}
	}

	scale, _ := rules["scale"].(string)
	is400 := scale == "400" || scale == "UTME"

	subjectScores := make([]SubjectScore, 0, len(perSubject))
	var bandSum float64
	for subj, a := range perSubject {
		frac := 0.0
		if a.total > 0 {
			frac = float64(a.raw) / float64(a.total)
		}
		ss := SubjectScore{Subject: subj, Raw: a.raw, Total: a.total}
		if is400 {
			// UTME: each subject contributes proportionally; per-subject scaled to /100.
			ss.Scaled = math.Round(frac * 100)
		} else {
			ss.Scaled = math.Round(frac * 100)
			ss.Grade = gradeBand(frac, rules)
			bandSum += frac * 100
		}
		subjectScores = append(subjectScores, ss)
	}

	overallFrac := 0.0
	if totalItems > 0 {
		overallFrac = float64(totalCorrect) / float64(totalItems)
	}

	var overall float64
	var overallGrade string
	if is400 {
		overall = math.Round(overallFrac * 400) // UTME 400-scale
	} else {
		if len(subjectScores) > 0 {
			overall = math.Round(bandSum / float64(len(subjectScores)))
		}
		overallGrade = gradeBand(overallFrac, rules)
	}

	// Readiness = coverage × mastery × mock.
	mock := overallFrac // mock-performance factor
	coverage := 1.0     // Phase 1: full coverage of the blueprint that was attempted.
	masteryFactor := 0.0
	if totalObj > 0 {
		masteryFactor = float64(mastered) / float64(totalObj)
	}
	var readiness float64
	if totalObj == 0 {
		readiness = mock // mock-only fallback when no mastery data
	} else {
		readiness = coverage * masteryFactor * mock
	}
	readiness = math.Round(readiness*1000) / 1000 // 3dp

	return Result{
		Subjects:  subjectScores,
		Overall:   overall,
		Grade:     overallGrade,
		Readiness: readiness,
		Predicted: map[string]any{
			"basis":        "mock_history",
			"overall_frac": overallFrac,
			"projected":    overall,
		},
	}
}

// gradeBand maps a 0..1 fraction to a letter grade. scoring_rules.bands may override
// the thresholds: {"A1":0.75,"B2":0.70,...}. Default is the WASSCE 9-point ladder.
func gradeBand(frac float64, rules map[string]any) string {
	pct := frac * 100
	// Custom bands provided as {grade: minPercent}.
	if raw, ok := rules["bands"].(map[string]any); ok && len(raw) > 0 {
		best := ""
		bestMin := -1.0
		for grade, v := range raw {
			min := toFloat(v)
			if pct >= min && min > bestMin {
				best = grade
				bestMin = min
			}
		}
		if best != "" {
			return best
		}
	}
	switch {
	case pct >= 75:
		return "A1"
	case pct >= 70:
		return "B2"
	case pct >= 65:
		return "B3"
	case pct >= 60:
		return "C4"
	case pct >= 55:
		return "C5"
	case pct >= 50:
		return "C6"
	case pct >= 45:
		return "D7"
	case pct >= 40:
		return "E8"
	default:
		return "F9"
	}
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	default:
		return 0
	}
}

// resultToScoreMap renders a Result into the jsonb shape persisted in academy_attempts.score.
func resultToScoreMap(res Result) map[string]any {
	subs := make([]map[string]any, 0, len(res.Subjects))
	for _, s := range res.Subjects {
		m := map[string]any{"subject": s.Subject, "raw": s.Raw, "total": s.Total, "scaled": s.Scaled}
		if s.Grade != "" {
			m["grade"] = s.Grade
		}
		subs = append(subs, m)
	}
	out := map[string]any{
		"subjects": subs,
		"overall":  res.Overall,
		"late":     res.Late,
	}
	if res.Grade != "" {
		out["grade"] = res.Grade
	}
	return out
}

// isCorrect compares a learner's selected answer with the item's canonical answer.
// MCQ convention: answer = {"correct": <value>} and selected = {"value": <value>}
// (or {"correct"/"selected": <value>}).
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
	return normalize(a) == normalize(b)
}

func normalize(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case float64:
		return fmt.Sprintf("%g", t)
	default:
		return fmt.Sprintf("%v", t)
	}
}
