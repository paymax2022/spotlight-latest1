package connectassess

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/quiz"
	arenasvc "spotlight/backend/internal/arena/service"
)

// quizScorer adapts the reused Naija Driver quiz engine to the Scorer interface.
// It REUSES (never forks) quiz.Repository (questions + append-only idempotent
// attempts), quiz.Service.StageView (contestant-safe question envelope) and
// quiz.Service.ScorePlayAlong (marking + attempt persistence).
type quizScorer struct{ svc *quiz.Service }

// NewQuizScorer builds the engine-backed scorer over the shared pool.
//
// The engine's ScorePlayAlong delegates engagement/credential/cashback to a
// PlayAlongPort; skill assessments want NONE of that — only the raw score plus the
// append-only attempt row. So we inject a no-op PlayAlong port. The engine's
// ContestantPort is used only by the proctored Theory-exam path (never reached
// here), so it is nil.
func NewQuizScorer(pool *pgxpool.Pool) Scorer {
	svc := quiz.NewService(quiz.NewRepository(pool), noopPlayAlong{}, nil)
	return &quizScorer{svc: svc}
}

func (s *quizScorer) StageView(ctx context.Context, competitionID, bankKey, rubricVersion string, stage int) (quiz.StageView, error) {
	return s.svc.StageView(ctx, competitionID, bankKey, rubricVersion, stage)
}

func (s *quizScorer) Score(ctx context.Context, competitionID, bankKey, rubricVersion, takerID string, stage int, answers []Answer, idemKey string) (int, int, error) {
	qa := make([]quiz.Answer, len(answers))
	for i, a := range answers {
		qa[i] = quiz.Answer{QuestionID: a.QuestionID, OptionID: a.OptionID}
	}
	res, err := s.svc.ScorePlayAlong(ctx, competitionID, bankKey, rubricVersion, takerID, stage, qa, idemKey)
	if err != nil {
		return 0, 0, err
	}
	return res.Score, res.Total, nil
}

// noopPlayAlong satisfies quiz.PlayAlongPort with a no-op: skill assessments must
// NOT touch the arena engagement/credential/cashback rail. The engine still writes
// the append-only arena_quiz_attempt row before calling this.
type noopPlayAlong struct{}

func (noopPlayAlong) Attempt(_ context.Context, _, _, _ string, _ arenasvc.AttemptPayload) (*arenasvc.AttemptResult, error) {
	return &arenasvc.AttemptResult{}, nil
}
