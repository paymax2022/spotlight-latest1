package kyc

// ---------------------------------------------------------------------------
// LIVE-DB regression: Approve() is the single funnel every KYC-verification
// path resolves through (webhook auto-elevation AND manual admin approval —
// see WithKYCPointsAwarder's doc comment), so the Refer & Earn KYC-update
// point (Module 8, 2026-09-18) is wired here rather than in any one caller.
// This pins that the award actually fires exactly once per Approve call, is
// non-fatal to the tier upgrade if it errors, and is a true no-op when no
// awarder is configured (the pre-existing, unmodified behavior).
//
// SKIPPED whenever TEST_DATABASE_URL is unset.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/finance/kyc/... -run KYCPoints -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func kycPointsPoolOrSkip(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func seedKYCUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	email := "kyc-points-" + id + "@seed.test"
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2)`, id, email); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	// handle_new_user() already inserts a user_profiles row on the auth.users
	// insert above — upsert rather than a bare INSERT to tolerate that.
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`, id, email); err != nil {
		t.Fatalf("seed user_profiles: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM kyc_events WHERE user_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM user_profiles WHERE id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, id)
	})
	return id
}

type fakeKYCPointsAwarder struct {
	calls []string
	err   error
}

func (f *fakeKYCPointsAwarder) AwardKYCPoints(_ context.Context, userID string) error {
	f.calls = append(f.calls, userID)
	return f.err
}

func TestLiveDB_Approve_AwardsKYCPointsExactlyOnce(t *testing.T) {
	pool := kycPointsPoolOrSkip(t)
	ctx := context.Background()
	user := seedKYCUser(t, ctx, pool)

	awarder := &fakeKYCPointsAwarder{}
	svc := NewService(pool).WithKYCPointsAwarder(awarder)

	if _, err := svc.Approve(ctx, user, 1, nil); err != nil {
		t.Fatalf("Approve: %v", err)
	}

	if len(awarder.calls) != 1 || awarder.calls[0] != user {
		t.Errorf("KYC points awarder calls = %v, want exactly one call for %q", awarder.calls, user)
	}
}

func TestLiveDB_Approve_SucceedsWhenPointsAwardFails(t *testing.T) {
	pool := kycPointsPoolOrSkip(t)
	ctx := context.Background()
	user := seedKYCUser(t, ctx, pool)

	awarder := &fakeKYCPointsAwarder{err: errors.New("boom")}
	svc := NewService(pool).WithKYCPointsAwarder(awarder)

	profile, err := svc.Approve(ctx, user, 1, nil)
	if err != nil {
		t.Fatalf("Approve must succeed even when the points award fails, got: %v", err)
	}
	if profile == nil || profile.Status != StatusVerified {
		t.Errorf("profile = %+v, want Status=verified — the tier upgrade must stand regardless of the points award outcome", profile)
	}
}

func TestLiveDB_Approve_NoAwarderConfiguredIsANoOp(t *testing.T) {
	pool := kycPointsPoolOrSkip(t)
	ctx := context.Background()
	user := seedKYCUser(t, ctx, pool)

	svc := NewService(pool) // no WithKYCPointsAwarder call — pre-existing behavior
	if _, err := svc.Approve(ctx, user, 1, nil); err != nil {
		t.Fatalf("Approve: %v", err)
	}
}
