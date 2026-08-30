package spotlightwealth_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the Spotlight Wealth module.
//
// spotlightwealth.Service (spotlightwealth.NewService(pool, ledgerSvc, audit))
// talks to a concrete *pgxpool.Pool for every mutation (JoinChallenge,
// CompleteChallenge) and to the real ledger.Service for the reward's balanced
// double-entry posting. None of this can run without a migrated Postgres. This
// file is SKIPPED whenever TEST_DATABASE_URL is unset (same
// pattern as backend/tests/association/live_db_integration_test.go), but is
// fully written end-to-end so it can be un-skipped the moment infra is
// available — the skip is NOT a stub; every step below drives the real Service
// against real tables.
//
// ── Bring-up note (read before running) ───────────────────────────────────
//  1. Apply the spotlightwealth migration (spotlight_challenges,
//     spotlight_challenge_members, spotlight_reward_ledger,
//     spotlight_learning_points, etc.). Confirm the core tables landed:
//       psql "$TEST_DATABASE_URL" -c "\d spotlight_challenges"
//       psql "$TEST_DATABASE_URL" -c "\d spotlight_reward_ledger"
//  2. Also apply the finance/ledger migrations (standing accounts, journal
//     tables) since CompleteChallenge posts through the real ledger.Service.
//  3. Set TEST_DATABASE_URL to a disposable/test database —
//     never point this at production. `supabase db reset` (local, port 54322)
//     is the safest target:
//       export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  4. Run:
//       cd backend && go test ./tests/spotlightwealth/... -run LiveDB -v
//
// Every row this file touches is created by the test itself with a fresh
// uuid.New() id — no truncation, no shared fixtures, safe to run repeatedly
// against the same test database.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/spotlightwealth"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB spotlightwealth integration test; see bring-up note in live_db_integration_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// newLiveLedgerService wires ledger.Service exactly as production does
// elsewhere in this repo (see backend/tests/association/live_db_integration_test.go),
// using a nil Redis client (confirmed nil-safe pattern in ledger.Service).
func newLiveLedgerService(pool *pgxpool.Pool) *ledger.Service {
	ledRepo := ledger.NewRepository(pool)
	return ledger.NewService(ledRepo, (*goredis.Client)(nil))
}

func newIdemKey(t *testing.T, label string) string {
	t.Helper()
	return label + "-" + uuid.New().String()
}

// seedChallenge inserts a published challenge with the given reward and
// returns its id.
func seedChallenge(t *testing.T, ctx context.Context, pool *pgxpool.Pool, rewardKobo int64) string {
	t.Helper()
	id := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO spotlight_challenges (id, title, description, reward_kobo, currency, ends_at, kind, published)
		VALUES ($1, 'Test Challenge', 'desc', $2, 'NGN', now() + interval '30 days', 'literacy', true)`,
		id, rewardKobo)
	if err != nil {
		t.Fatalf("seed challenge: %v", err)
	}
	return id
}

// seedEndedChallenge inserts a published challenge whose ends_at is in the past.
func seedEndedChallenge(t *testing.T, ctx context.Context, pool *pgxpool.Pool, rewardKobo int64) string {
	t.Helper()
	id := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO spotlight_challenges (id, title, description, reward_kobo, currency, ends_at, kind, published)
		VALUES ($1, 'Ended Challenge', 'desc', $2, 'NGN', now() - interval '1 day', 'literacy', true)`,
		id, rewardKobo)
	if err != nil {
		t.Fatalf("seed ended challenge: %v", err)
	}
	return id
}

// seedWallet credits userID's wallet with amountKobo via a direct ledger
// credit from a synthetic funding standing account, matching the pattern in
// backend/tests/association/live_db_integration_test.go. Not required for
// CompleteChallenge (which pays FROM revenue, not from the user's wallet), but
// provided for completeness / future money-path tests in this package.
func seedWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	settle, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("seed wallet: standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "test-seed:"+uuid.New().String(), "test-seed-idem:"+uuid.New().String(), settle.ID, amountKobo); err != nil {
		t.Fatalf("seed wallet: credit: %v", err)
	}
}

// ---------------------------------------------------------------------------
// CompleteChallenge: idempotency, balanced posting, reward wallet history.
// ---------------------------------------------------------------------------

// TestLiveDB_CompleteChallenge_IdempotentRetry_OneLedgerCreditOneRewardRow
// drives a real challenge completion twice with the SAME Idempotency-Key and
// proves: (a) exactly one spotlight_reward_ledger row, (b) the reward wallet
// balance equals the reward exactly once (not doubled), and (c) the caller's
// wallet balance increases by exactly the reward amount (the balanced credit
// from paymax_revenue).

// seedUser inserts a synthetic auth.users row so FKs (user_id -> auth.users) are
// satisfied on a fresh Supabase DB. Needed by the persistence + ledger paths.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	// email is required by the handle_new_user trigger (user_profiles.email NOT NULL).
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return id
}

func TestLiveDB_CompleteChallenge_IdempotentRetry_OneLedgerCreditOneRewardRow(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	led := newLiveLedgerService(pool)
	svc := spotlightwealth.NewService(pool, led, nil)
	ctx := context.Background()

	const rewardKobo = int64(2_500_00) // ₦2,500
	challengeID := seedChallenge(t, ctx, pool, rewardKobo)
	userID := seedUser(t, ctx, pool)

	if _, err := svc.JoinChallenge(ctx, userID, challengeID); err != nil {
		t.Fatalf("JoinChallenge: %v", err)
	}

	balBefore, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance before: %v", err)
	}

	key := newIdemKey(t, "complete")
	first, err := svc.CompleteChallenge(ctx, userID, challengeID, key)
	if err != nil {
		t.Fatalf("first CompleteChallenge: %v", err)
	}
	if first.Balance.Amount != float64(rewardKobo)/100.0 {
		t.Fatalf("reward wallet balance after first complete = %v, want %v", first.Balance.Amount, float64(rewardKobo)/100.0)
	}

	// Retry with the SAME idempotency key — the guarded state-machine
	// transition (JOINED->COMPLETED) already fired, so this must be a no-op.
	second, err := svc.CompleteChallenge(ctx, userID, challengeID, key)
	if err != nil {
		t.Fatalf("retried CompleteChallenge: %v", err)
	}
	if second.Balance.Amount != first.Balance.Amount {
		t.Errorf("reward wallet balance changed on retry: first=%v second=%v", first.Balance.Amount, second.Balance.Amount)
	}

	var rewardRowCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM spotlight_reward_ledger WHERE user_id=$1`, userID).Scan(&rewardRowCount); err != nil {
		t.Fatalf("count reward rows: %v", err)
	}
	if rewardRowCount != 1 {
		t.Errorf("spotlight_reward_ledger rows = %d, want exactly 1 (no double posting on retry)", rewardRowCount)
	}

	balAfter, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after: %v", err)
	}
	if balAfter-balBefore != rewardKobo {
		t.Errorf("wallet balance increased by %d, want exactly %d (balanced credit from paymax_revenue, no double-pay)", balAfter-balBefore, rewardKobo)
	}
}

// TestLiveDB_CompleteChallenge_RequiresJoinFirst proves the ErrForbidden guard
// (service.go: memberState=="" -> ErrForbidden) fires end-to-end for a caller
// who never joined, and posts nothing.
func TestLiveDB_CompleteChallenge_RequiresJoinFirst(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	led := newLiveLedgerService(pool)
	svc := spotlightwealth.NewService(pool, led, nil)
	ctx := context.Background()

	challengeID := seedChallenge(t, ctx, pool, 1_000_00)
	stranger := uuid.New().String()

	_, err := svc.CompleteChallenge(ctx, stranger, challengeID, newIdemKey(t, "never-joined"))
	if err != spotlightwealth.ErrForbidden {
		t.Fatalf("CompleteChallenge without joining first: err = %v, want ErrForbidden", err)
	}

	var rewardRowCount int
	if scanErr := pool.QueryRow(ctx, `SELECT count(*) FROM spotlight_reward_ledger WHERE user_id=$1`, stranger).Scan(&rewardRowCount); scanErr != nil {
		t.Fatalf("count reward rows: %v", scanErr)
	}
	if rewardRowCount != 0 {
		t.Errorf("a forbidden completion must not write any reward row, found %d", rewardRowCount)
	}
}

// TestLiveDB_CompleteChallenge_RequiresIdempotencyKey proves the fail-closed
// guard end-to-end: an empty Idempotency-Key is rejected before any DB write.
func TestLiveDB_CompleteChallenge_RequiresIdempotencyKey(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	led := newLiveLedgerService(pool)
	svc := spotlightwealth.NewService(pool, led, nil)
	ctx := context.Background()

	challengeID := seedChallenge(t, ctx, pool, 1_000_00)
	userID := seedUser(t, ctx, pool)
	if _, err := svc.JoinChallenge(ctx, userID, challengeID); err != nil {
		t.Fatalf("JoinChallenge: %v", err)
	}

	_, err := svc.CompleteChallenge(ctx, userID, challengeID, "")
	if err != spotlightwealth.ErrBadInput {
		t.Fatalf("CompleteChallenge with empty Idempotency-Key: err = %v, want ErrBadInput", err)
	}

	var memberState string
	if scanErr := pool.QueryRow(ctx, `SELECT state FROM spotlight_challenge_members WHERE challenge_id=$1 AND user_id=$2`, challengeID, userID).Scan(&memberState); scanErr != nil {
		t.Fatalf("read member state: %v", scanErr)
	}
	if memberState != "JOINED" {
		t.Errorf("member state after rejected completion = %s, want still JOINED (no state change without a key)", memberState)
	}
}

// TestLiveDB_CompleteChallenge_ZeroRewardChallenge_CompletesWithNoLedgerPost
// proves a zero-reward challenge still transitions the member to COMPLETED
// (so progress/UX isn't blocked) but posts nothing to the ledger or reward
// table.
func TestLiveDB_CompleteChallenge_ZeroRewardChallenge_CompletesWithNoLedgerPost(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	led := newLiveLedgerService(pool)
	svc := spotlightwealth.NewService(pool, led, nil)
	ctx := context.Background()

	challengeID := seedChallenge(t, ctx, pool, 0)
	userID := seedUser(t, ctx, pool)
	if _, err := svc.JoinChallenge(ctx, userID, challengeID); err != nil {
		t.Fatalf("JoinChallenge: %v", err)
	}

	if _, err := svc.CompleteChallenge(ctx, userID, challengeID, newIdemKey(t, "zero-reward")); err != nil {
		t.Fatalf("CompleteChallenge (zero reward): %v", err)
	}

	var memberState string
	if err := pool.QueryRow(ctx, `SELECT state FROM spotlight_challenge_members WHERE challenge_id=$1 AND user_id=$2`, challengeID, userID).Scan(&memberState); err != nil {
		t.Fatalf("read member state: %v", err)
	}
	if memberState != "COMPLETED" {
		t.Errorf("member state = %s, want COMPLETED even with a zero reward", memberState)
	}

	var rewardRowCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM spotlight_reward_ledger WHERE user_id=$1`, userID).Scan(&rewardRowCount); err != nil {
		t.Fatalf("count reward rows: %v", err)
	}
	if rewardRowCount != 0 {
		t.Errorf("reward rows for a zero-reward completion = %d, want 0", rewardRowCount)
	}
}

// TestLiveDB_JoinChallenge_RejectsEndedChallenge proves ErrChallengeEnded
// fires for a challenge whose ends_at is already in the past, and no
// membership row is created.
func TestLiveDB_JoinChallenge_RejectsEndedChallenge(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	led := newLiveLedgerService(pool)
	svc := spotlightwealth.NewService(pool, led, nil)
	ctx := context.Background()

	challengeID := seedEndedChallenge(t, ctx, pool, 1_000_00)
	userID := seedUser(t, ctx, pool)

	_, err := svc.JoinChallenge(ctx, userID, challengeID)
	if err != spotlightwealth.ErrChallengeEnded {
		t.Fatalf("JoinChallenge on an ended challenge: err = %v, want ErrChallengeEnded", err)
	}

	var memberCount int
	if scanErr := pool.QueryRow(ctx, `SELECT count(*) FROM spotlight_challenge_members WHERE challenge_id=$1 AND user_id=$2`, challengeID, userID).Scan(&memberCount); scanErr != nil {
		t.Fatalf("count members: %v", scanErr)
	}
	if memberCount != 0 {
		t.Errorf("a rejected join must not create a membership row, found %d", memberCount)
	}
}

// ---------------------------------------------------------------------------
// Leaderboard: ranks learning points, live read-path smoke check.
// ---------------------------------------------------------------------------

// seedLearningPoints inserts a spotlight_learning_points row for a synthetic
// user and returns the user id.
func seedLearningPoints(t *testing.T, ctx context.Context, pool *pgxpool.Pool, displayName string, points int) string {
	t.Helper()
	userID := seedUser(t, ctx, pool)
	if _, err := pool.Exec(ctx, `
		INSERT INTO spotlight_learning_points (user_id, display_name, points)
		VALUES ($1,$2,$3)
		ON CONFLICT (user_id) DO UPDATE SET points=EXCLUDED.points`, userID, displayName, points); err != nil {
		t.Fatalf("seed learning points: %v", err)
	}
	return userID
}

// TestLiveDB_Leaderboard_OrdersByPointsDescendingAndLabelsCaller proves the
// live read path orders by points DESC and relabels the caller's own row "You".
func TestLiveDB_Leaderboard_OrdersByPointsDescendingAndLabelsCaller(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	led := newLiveLedgerService(pool)
	svc := spotlightwealth.NewService(pool, led, nil)
	ctx := context.Background()

	topUser := seedLearningPoints(t, ctx, pool, "Top Learner "+uuid.New().String()[:8], 10_000)
	callerUser := seedLearningPoints(t, ctx, pool, "Caller "+uuid.New().String()[:8], 5_000)

	entries, err := svc.Leaderboard(ctx, callerUser)
	if err != nil {
		t.Fatalf("Leaderboard: %v", err)
	}
	if len(entries) < 2 {
		t.Fatalf("expected at least 2 leaderboard entries, got %d", len(entries))
	}

	var topEntry, callerEntry *spotlightwealth.LeaderboardEntry
	for i := range entries {
		if entries[i].Points == 10_000 {
			topEntry = &entries[i]
		}
		if entries[i].DisplayName == "You" {
			callerEntry = &entries[i]
		}
	}
	if topEntry == nil {
		t.Fatal("seeded top-points row not found in leaderboard")
	}
	if callerEntry == nil {
		t.Fatal("caller's own row was not relabeled 'You'")
	}
	if callerEntry.Rank <= topEntry.Rank {
		t.Errorf("caller (points=5000) must rank BELOW the top user (points=10000): caller rank=%d, top rank=%d", callerEntry.Rank, topEntry.Rank)
	}
	_ = topUser
}

var _ = time.Now // keep time import available for future test additions without churn
