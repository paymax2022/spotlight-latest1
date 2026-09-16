package promotion

// LIVE-DB test for the promotion-ladder service: registration, readiness updates,
// the full audited climb (maker≠checker enforced, Risk+legal required for Live),
// gate rejections persisted as no-ops, halt, and the Evaluable gate.
// Skipped unless TEST_DATABASE_URL is set —
// deliberately with NO fallback to DATABASE_URL, which the root .env points
// at the PRODUCTION Supabase pooler.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/trading/ladder"
)

func live(t *testing.T) (*Service, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping promotion live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return NewService(pool), pool
}

func TestPromotion_FullClimbAndGates_LiveDB(t *testing.T) {
	s, pool := live(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	sid := "strat-" + uuid.NewString()
	maker, checker := uuid.NewString(), uuid.NewString()

	if err := s.Register(ctx, sid); err != nil {
		t.Fatalf("register: %v", err)
	}
	st, _ := s.Get(ctx, sid)
	if st.Stage != ladder.StageNotPromoted {
		t.Fatalf("fresh strategy should be not_promoted, got %s", st.Stage)
	}

	// Enter paper (no evidence needed).
	if _, err := s.Promote(ctx, checker, sid, ladder.StagePaper, maker, false, false); err != nil {
		t.Fatalf("→paper: %v", err)
	}

	// Record a passing verdict + long track record.
	if _, err := s.SetReadiness(ctx, checker, sid, true, 120, false); err != nil {
		t.Fatalf("readiness: %v", err)
	}

	// Climb paper → shadow → canary.
	if _, err := s.Promote(ctx, checker, sid, ladder.StageShadow, maker, false, false); err != nil {
		t.Fatalf("→shadow: %v", err)
	}
	if _, err := s.Promote(ctx, checker, sid, ladder.StageCanary, maker, false, false); err != nil {
		t.Fatalf("→canary: %v", err)
	}

	// Canary→Live WITHOUT Risk/legal sign-off must be denied and leave stage unchanged.
	if _, err := s.Promote(ctx, checker, sid, ladder.StageLive, maker, false, false); !errors.Is(err, ErrDenied) {
		t.Fatalf("live without sign-off should be denied, got %v", err)
	}
	if st, _ := s.Get(ctx, sid); st.Stage != ladder.StageCanary {
		t.Fatalf("denied promotion must not move the stage, got %s", st.Stage)
	}

	// maker == checker must be denied (separation of duties).
	if _, err := s.Promote(ctx, maker, sid, ladder.StageLive, maker, true, true); !errors.Is(err, ErrDenied) {
		t.Fatalf("maker==checker should be denied, got %v", err)
	}

	// Full sign-off → Live.
	if _, err := s.Promote(ctx, checker, sid, ladder.StageLive, maker, true, true); err != nil {
		t.Fatalf("→live with full sign-off: %v", err)
	}
	if st, _ := s.Get(ctx, sid); st.Stage != ladder.StageLive {
		t.Fatalf("expected live, got %s", st.Stage)
	}

	// Evaluable at Live.
	if _, ok, _ := s.Evaluable(ctx, sid); !ok {
		t.Fatal("live strategy must be evaluable")
	}

	// Halt from Live → halted; no longer evaluable.
	if _, err := s.Halt(ctx, checker, sid, "circuit breaker in prod"); err != nil {
		t.Fatalf("halt: %v", err)
	}
	if _, ok, _ := s.Evaluable(ctx, sid); ok {
		t.Fatal("halted strategy must not be evaluable")
	}

	// The audit trail recorded every step (register, →paper, readiness, →shadow,
	// →canary, →live, halt = 7 non-denied events; denied attempts are no-ops).
	evs, err := s.Events(ctx, sid, 50)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if len(evs) < 7 {
		t.Fatalf("expected >=7 audit events, got %d", len(evs))
	}
}
