package gamification_test

// Live-DB tests for the mission-claim gate. SKIPPED whenever TEST_DATABASE_URL
// is unset — same convention as internal/finance/referrals/rewards_service_test.go.
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/referral/gamification/... -v
//
// Regression: MarkClaimed used to INSERT 'claimed' unconditionally on the no-row
// arm, so a mission at progress 0 was claimable (and any cash_reward_kobo on it
// would have minted an unearned referral-ledger accrual).

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/referral/gamification"
	"spotlight/backend/internal/testsupport"
)

func liveGamifPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB gamification test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedGamifUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, "gamif-"+uid+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	return uid
}

func seedMission(t *testing.T, repo *gamification.Repository) *gamification.Mission {
	t.Helper()
	m, err := repo.CreateMission(context.Background(), gamification.MissionInput{
		Slug:         "t-" + uuid.NewString()[:12],
		Title:        "test mission",
		TargetCount:  3,
		PointsReward: 100,
		IsActive:     true,
	})
	if err != nil {
		t.Fatalf("create mission: %v", err)
	}
	return m
}

func progressStatus(t *testing.T, pool *pgxpool.Pool, missionID, uid string) string {
	t.Helper()
	var status string
	err := pool.QueryRow(context.Background(),
		`SELECT status FROM referral_mission_progress WHERE mission_id=$1 AND user_id=$2`,
		missionID, uid).Scan(&status)
	if err != nil {
		return "" // no row
	}
	return status
}

// The core regression: with NO progress row at all (the common case), the claim
// must fail closed — previously it stamped 'claimed' at progress 0 and paid out.
func TestLiveDB_MarkClaimed_NoProgressRow_NotClaimable(t *testing.T) {
	pool := liveGamifPool(t)
	repo := gamification.NewRepository(pool)
	svc := gamification.NewService(repo, nil)
	ctx := context.Background()
	uid := seedGamifUser(t, pool)
	m := seedMission(t, repo)

	claimed, err := repo.MarkClaimed(ctx, m.ID, uid, "k-"+uuid.NewString())
	if err != nil {
		t.Fatalf("MarkClaimed: %v", err)
	}
	if claimed {
		t.Fatal("MarkClaimed claimed a mission with no progress row")
	}
	if st := progressStatus(t, pool, m.ID, uid); st != "" {
		t.Fatalf("no-row claim must not create a progress row, found status=%q", st)
	}
	if _, err := svc.Claim(ctx, m.ID, uid, "k-"+uuid.NewString()); err == nil ||
		!strings.Contains(err.Error(), "not completed") {
		t.Fatalf("service claim should fail 'not completed', got %v", err)
	}
}

func TestLiveDB_MarkClaimed_InProgressRow_NotClaimable(t *testing.T) {
	pool := liveGamifPool(t)
	repo := gamification.NewRepository(pool)
	svc := gamification.NewService(repo, nil)
	ctx := context.Background()
	uid := seedGamifUser(t, pool)
	m := seedMission(t, repo)

	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_mission_progress (mission_id, user_id, progress, status)
		 VALUES ($1,$2,1,'in_progress')`, m.ID, uid); err != nil {
		t.Fatalf("seed progress: %v", err)
	}

	claimed, err := repo.MarkClaimed(ctx, m.ID, uid, "k-"+uuid.NewString())
	if err != nil {
		t.Fatalf("MarkClaimed: %v", err)
	}
	if claimed {
		t.Fatal("MarkClaimed claimed an in_progress mission")
	}
	if st := progressStatus(t, pool, m.ID, uid); st != "in_progress" {
		t.Fatalf("in_progress row must be untouched, found %q", st)
	}
	if _, err := svc.Claim(ctx, m.ID, uid, "k-"+uuid.NewString()); err == nil {
		t.Fatal("service claim should fail for in_progress mission")
	}
}

// The happy path + replay: completed → claimed once, second claim is an
// idempotent no-award (status 'claimed', zero points awarded).
func TestLiveDB_MarkClaimed_CompletedClaimsOnce(t *testing.T) {
	pool := liveGamifPool(t)
	repo := gamification.NewRepository(pool)
	svc := gamification.NewService(repo, nil)
	ctx := context.Background()
	uid := seedGamifUser(t, pool)
	m := seedMission(t, repo)

	if _, err := pool.Exec(ctx,
		`INSERT INTO referral_mission_progress (mission_id, user_id, progress, status)
		 VALUES ($1,$2,3,'completed')`, m.ID, uid); err != nil {
		t.Fatalf("seed progress: %v", err)
	}

	res, err := svc.Claim(ctx, m.ID, uid, "k-"+uuid.NewString())
	if err != nil {
		t.Fatalf("claim completed mission: %v", err)
	}
	if res.Status != gamification.ProgressClaimed || res.PointsAwarded != 100 {
		t.Fatalf("unexpected claim result: %+v", res)
	}
	if st := progressStatus(t, pool, m.ID, uid); st != "claimed" {
		t.Fatalf("expected status=claimed, got %q", st)
	}

	// Replay: no error, no second award (PointsAwarded stays 0 on the replay path).
	replay, err := svc.Claim(ctx, m.ID, uid, "k-"+uuid.NewString())
	if err != nil {
		t.Fatalf("replay claim should be idempotent, got %v", err)
	}
	if replay.Status != gamification.ProgressClaimed || replay.PointsAwarded != 0 {
		t.Fatalf("replay must return claimed with 0 new points, got %+v", replay)
	}
}
