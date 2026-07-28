package service

import (
	"context"
	"testing"

	"spotlight/backend/internal/arena"
)

// fakeContestantRepo is a no-DB contestant store for the lifecycle-guard test.
type fakeContestantRepo struct {
	byID map[string]*Contestant
}

func newFakeContestantRepo(c *Contestant) *fakeContestantRepo {
	return &fakeContestantRepo{byID: map[string]*Contestant{c.ID: c}}
}
func (f *fakeContestantRepo) Create(context.Context, string, string, int, string) (*Contestant, error) {
	return nil, ErrConflict
}
func (f *fakeContestantRepo) Get(_ context.Context, _, id string) (*Contestant, error) {
	if c, ok := f.byID[id]; ok {
		return c, nil
	}
	return nil, ErrNotFound
}
func (f *fakeContestantRepo) GetByUser(context.Context, string, string) (*Contestant, error) {
	return nil, ErrNotFound
}
func (f *fakeContestantRepo) ListByState(context.Context, string, arena.ContestantState) ([]Contestant, error) {
	return nil, nil
}
func (f *fakeContestantRepo) UpdateState(_ context.Context, id string, from, to arena.ContestantState, sideEffect func(ctx context.Context) error) error {
	c, ok := f.byID[id]
	if !ok || c.State != from {
		return ErrConflict
	}
	if sideEffect != nil {
		if err := sideEffect(context.Background()); err != nil {
			return err
		}
	}
	c.State = to
	return nil
}

// TestLifecycle_GuardRejectsIllegalJump proves the service refuses a transition
// that is not a legal lifecycle move (arena.CanTransition), without any merit or
// money read.
func TestLifecycle_GuardRejectsIllegalJump(t *testing.T) {
	c := &Contestant{ID: "k1", CompetitionID: "c1", UserID: "u1", State: arena.StApplied}
	repo := newFakeContestantRepo(c)
	svc := NewContestantService(repo, nil, nil, nil, nil, fakeTier{3}, fakeCfg{Config{}}, &fakeAudit{}, nil)

	// APPLIED → CROWNED is an illegal jump.
	if err := svc.Transition(context.Background(), "actor", "c1", "k1", arena.StCrowned, "x"); err != ErrBadState {
		t.Fatalf("illegal jump must be ErrBadState, got %v", err)
	}
	// A legal non-advancement move (APPLIED → SCREENED) passes the guard (no merit read).
	if err := svc.Transition(context.Background(), "actor", "c1", "k1", arena.StScreened, "ok"); err != nil {
		t.Fatalf("legal transition must pass: %v", err)
	}
	if c.State != arena.StScreened {
		t.Fatalf("state must advance to SCREENED, got %s", c.State)
	}
}
