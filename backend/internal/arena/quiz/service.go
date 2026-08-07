package quiz

import (
	"context"
	"strconv"
	"strings"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/service"
)

// PlayAlongPort is the subset of the existing PlayAlongService the quiz service
// delegates engagement + credential + cashback to (NDC-1: the quiz service holds
// no signer and cannot mint merit; it only records attempts and hands the scored
// result to the engagement rail).
type PlayAlongPort interface {
	Attempt(ctx context.Context, userID, idemKey, competitionID string, payload service.AttemptPayload) (*service.AttemptResult, error)
}

// ContestantPort is the subset of the contestant lifecycle the exam flow needs:
// read the caller's contestant row and perform the guarded THEORY_ASSIGNED →
// THEORY_TAKEN transition.
type ContestantPort interface {
	Me(ctx context.Context, competitionID, userID string) (*service.Contestant, error)
	Transition(ctx context.Context, actorID, competitionID, contestantID string, to arena.ContestantState, reason string) error
}

// Service holds the quiz bank logic shared by Play-Along and the Theory exam.
type Service struct {
	repo       *Repository
	playalong  PlayAlongPort
	contestant ContestantPort
}

// NewService builds the quiz service.
func NewService(repo *Repository, playalong PlayAlongPort, contestant ContestantPort) *Service {
	return &Service{repo: repo, playalong: playalong, contestant: contestant}
}

// ── Views ────────────────────────────────────────────────────────────────────

// ContestantView strips correct_index / correct_answer / explanation from a set of
// bank questions, yielding the contestant-safe projection.
func ContestantView(qs []Question) []QuestionView {
	out := make([]QuestionView, 0, len(qs))
	for _, q := range qs {
		opts := make([]OptionView, 0, len(q.Options))
		for i, label := range q.Options {
			opts = append(opts, OptionView{ID: strconv.Itoa(i), Label: label})
		}
		out = append(out, QuestionView{
			ID:            q.ExternalID,
			Category:      q.Category,
			Prompt:        q.Prompt,
			ImageURL:      q.ImageURL,
			Options:       opts,
			TimeLimitSecs: q.TimeLimitSecs,
		})
	}
	return out
}

// StageView loads a stage's contestant-safe envelope.
func (s *Service) StageView(ctx context.Context, competitionID, bankKey, rubricVersion string, stage int) (StageView, error) {
	qs, err := s.repo.ListForStage(ctx, bankKey, rubricVersion, stage, competitionID)
	if err != nil {
		return StageView{}, err
	}
	if len(qs) == 0 {
		return StageView{}, service.ErrNotFound
	}
	sv := StageView{
		StageNumber:     stage,
		StageName:       stageName(stage),
		PassMarkPercent: qs[0].PassMarkPercent,
		TimeLimitSecs:   qs[0].TimeLimitSecs,
		Questions:       ContestantView(qs),
	}
	return sv, nil
}

// ── Scoring ──────────────────────────────────────────────────────────────────

// mark scores the submitted answers against the stage questions. Unanswered /
// unknown-option → 0 for that question. Returns score, total, per-question reveal
// data and the persisted responses.
func mark(qs []Question, answers []Answer) (score, total int, reveals []Reveal, responses []Response) {
	chosen := map[string]int{} // external_id → option index (-1 = none)
	for _, a := range answers {
		idx := -1
		if v, err := strconv.Atoi(strings.TrimSpace(a.OptionID)); err == nil {
			idx = v
		}
		chosen[a.QuestionID] = idx
	}
	total = len(qs)
	reveals = make([]Reveal, 0, len(qs))
	responses = make([]Response, 0, len(qs))
	for _, q := range qs {
		picked, answered := chosen[q.ExternalID]
		correct := answered && picked == q.CorrectIndex
		if correct {
			score++
		}
		// Persist -1 for an unanswered question so the audit trail can tell
		// "did not answer" apart from "chose option 0" (both would be 0 otherwise).
		optionIndex := picked
		if !answered {
			optionIndex = -1
		}
		reveals = append(reveals, Reveal{
			QuestionID:      q.ExternalID,
			CorrectOptionID: strconv.Itoa(q.CorrectIndex),
			Explanation:     q.Explanation,
			Correct:         correct,
		})
		responses = append(responses, Response{
			QuestionExternalID: q.ExternalID,
			OptionIndex:        optionIndex,
			Correct:            correct,
		})
	}
	return score, total, reveals, responses
}

// passes reports whether score/total clears the stage pass mark percent.
func passes(score, total, passMarkPercent int) bool {
	if total <= 0 {
		return false
	}
	return score*100 >= passMarkPercent*total
}

// ScorePlayAlong scores a public Play-Along attempt: loads the stage bank, marks
// the answers, records an append-only arena_quiz_attempt (idempotent), then
// delegates engagement/credential/cashback to the existing PlayAlongService with
// Points=score, Passed=passed (NDC-1 — no merit ever). It returns the merged
// result INCLUDING the per-question reveal for the teaching moment.
func (s *Service) ScorePlayAlong(ctx context.Context, competitionID, bankKey, rubricVersion, takerID string, stage int, answers []Answer, idemKey string) (*PlayAlongResult, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, service.ErrMissingIdem
	}
	qs, err := s.repo.ListForStage(ctx, bankKey, rubricVersion, stage, competitionID)
	if err != nil {
		return nil, err
	}
	if len(qs) == 0 {
		return nil, service.ErrNotFound
	}
	score, total, reveals, responses := mark(qs, answers)
	passed := passes(score, total, qs[0].PassMarkPercent)

	rec := AttemptRecord{
		CompetitionID: competitionID, Mode: ModePlayAlong, TakerID: takerID,
		Stage: stage, RubricVersion: rubricVersion, Responses: responses,
		Score: score, Total: total, Passed: passed, IdempotencyKey: idemKey,
	}
	stored, _, err := s.repo.InsertAttempt(ctx, rec)
	if err != nil {
		return nil, err
	}
	// On a replay the stored score is authoritative.
	score, total, passed = stored.Score, stored.Total, stored.Passed

	res := &PlayAlongResult{
		Score: score, Total: total, Passed: passed, PerQuestion: reveals,
	}
	// Delegate engagement + credential + cashback (idempotent by the same key).
	ar, aerr := s.playalong.Attempt(ctx, takerID, idemKey, competitionID,
		service.AttemptPayload{Points: score, Passed: passed})
	if aerr != nil {
		return nil, aerr
	}
	res.CredentialIssued = ar.Certified
	res.CredentialHash = ar.Credential
	res.CashbackKobo = ar.CashbackKobo
	return res, nil
}

// ExamStage returns the caller's assigned Theory-exam stage envelope. Gated to the
// contestant state THEORY_ASSIGNED; the stage is derived from the contestant's
// theory_batch (B1→1, B2→2, B3→3). Returns ErrConflict when not assigned.
func (s *Service) ExamStage(ctx context.Context, competitionID, userID, bankKey, rubricVersion string) (StageView, string, error) {
	c, err := s.contestant.Me(ctx, competitionID, userID)
	if err != nil {
		return StageView{}, "", err
	}
	if c.State != arena.StTheoryAssigned {
		return StageView{}, "", service.ErrConflict
	}
	stage := batchToStage(c.TheoryBatch)
	if stage == 0 {
		return StageView{}, "", service.ErrConflict
	}
	sv, err := s.StageView(ctx, competitionID, bankKey, rubricVersion, stage)
	if err != nil {
		return StageView{}, "", err
	}
	return sv, c.TheoryBatch, nil
}

// SubmitExam scores + records the proctored exam attempt (mode THEORY_EXAM, batch =
// contestant.theory_batch), then performs the guarded THEORY_ASSIGNED →
// THEORY_TAKEN transition. It mints NO merit (NDC-2) — exam merit is minted only at
// proctor attestation, sourced from this stored attempt. Idempotent by idemKey and
// single-attempt per (contestant, batch): a replay returns the current state.
func (s *Service) SubmitExam(ctx context.Context, competitionID, userID string, bankKey, rubricVersion string, answers []Answer, responseTimeMs int64, idemKey string) (*ExamResult, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, service.ErrMissingIdem
	}
	c, err := s.contestant.Me(ctx, competitionID, userID)
	if err != nil {
		return nil, err
	}
	stage := batchToStage(c.TheoryBatch)
	if stage == 0 {
		return nil, service.ErrConflict
	}
	// Only score+record while assigned. If already taken, a re-submit is a no-op
	// that reports the terminal state (single attempt per contestant/batch).
	if c.State == arena.StTheoryTaken {
		return &ExamResult{OK: true, State: string(arena.StTheoryTaken)}, nil
	}
	if c.State != arena.StTheoryAssigned {
		return nil, service.ErrConflict
	}

	qs, err := s.repo.ListForStage(ctx, bankKey, rubricVersion, stage, competitionID)
	if err != nil {
		return nil, err
	}
	if len(qs) == 0 {
		return nil, service.ErrNotFound
	}
	score, total, _, responses := mark(qs, answers)
	passed := passes(score, total, qs[0].PassMarkPercent)

	rec := AttemptRecord{
		CompetitionID: competitionID, Mode: ModeTheoryExam, TakerID: userID,
		ContestantID: c.ID, Stage: stage, Batch: c.TheoryBatch, RubricVersion: rubricVersion,
		Responses: responses, Score: score, Total: total, Passed: passed,
		ResponseTimeMs: responseTimeMs, IdempotencyKey: idemKey,
	}
	if _, _, err := s.repo.InsertAttempt(ctx, rec); err != nil {
		return nil, err
	}
	// Guarded lifecycle advance (records actor + reason + audit; NDC-5).
	if err := s.contestant.Transition(ctx, userID, competitionID, c.ID,
		arena.StTheoryTaken, "theory exam submitted"); err != nil {
		return nil, err
	}
	return &ExamResult{OK: true, State: string(arena.StTheoryTaken)}, nil
}

// ── Import + stats ───────────────────────────────────────────────────────────

// Import binds the bank to the competition (idempotent) and returns per-stage
// counts.
func (s *Service) Import(ctx context.Context, competitionID, bankKey, rubricVersion string) (imported int, stages []StageStat, err error) {
	imported, err = s.repo.ImportBank(ctx, competitionID, bankKey, rubricVersion)
	if err != nil {
		return 0, nil, err
	}
	counts, err := s.repo.StageCounts(ctx, competitionID, bankKey, rubricVersion)
	if err != nil {
		return 0, nil, err
	}
	for _, st := range []int{1, 2, 3} {
		stages = append(stages, StageStat{Stage: st, QuestionCount: counts[st]})
	}
	return imported, stages, nil
}

// AdminList returns the FULL admin view (with correct index/answer/explanation).
func (s *Service) AdminList(ctx context.Context, competitionID string, stage int, category string) ([]Question, error) {
	return s.repo.ListForCompetition(ctx, competitionID, stage, category)
}

// Stats returns per-stage question + attempt + pass-rate stats for the console.
func (s *Service) Stats(ctx context.Context, competitionID, bankKey, rubricVersion string) (perStage []StageStat, total int, err error) {
	counts, err := s.repo.StageCounts(ctx, competitionID, bankKey, rubricVersion)
	if err != nil {
		return nil, 0, err
	}
	attempts, passes, err := s.repo.AttemptStats(ctx, competitionID)
	if err != nil {
		return nil, 0, err
	}
	for _, st := range []int{1, 2, 3} {
		var rate float64
		if attempts[st] > 0 {
			rate = float64(passes[st]) / float64(attempts[st])
		}
		perStage = append(perStage, StageStat{
			Stage:         st,
			QuestionCount: counts[st],
			AttemptCount:  attempts[st],
			PassRate:      rate,
		})
		total += counts[st]
	}
	return perStage, total, nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

func stageName(stage int) string {
	switch stage {
	case 1:
		return "Foundation — Road Rules, Signs & Documentation"
	case 2:
		return "Intermediate — Safe Driving Practice & FRSC Regulations"
	case 3:
		return "Advanced — Hazard Perception & Emergency Response"
	default:
		return ""
	}
}

// batchToStage maps a theory_batch (B1/B2/B3) to the quiz stage (1/2/3). Unknown → 0.
func batchToStage(batch string) int {
	switch strings.ToUpper(strings.TrimSpace(batch)) {
	case "B1":
		return 1
	case "B2":
		return 2
	case "B3":
		return 3
	default:
		return 0
	}
}

// StageToTheoryStage maps a quiz stage (1/2/3) to the arena Merit stage used by the
// TheoryExamAdapter when the proctor mints signed merit from the stored attempt.
func StageToTheoryStage(stage int) arena.Stage {
	switch stage {
	case 1:
		return arena.StageTheoryB1
	case 2:
		return arena.StageTheoryB2
	case 3:
		return arena.StageTheoryB3
	default:
		return arena.StageScreening
	}
}
