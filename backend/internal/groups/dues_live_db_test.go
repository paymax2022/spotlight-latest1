package groups

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for two stacked bugs found auditing GRP-4
// ("dues use ledger.Debit directly, bypassing the usual tier-limit check").
//
//  1. Create() inserted the group's wallet ledger account with group_id left
//     NULL, never binding it to the group just created. PayDues looks the
//     wallet up by group_id, so it could never find ANY group's wallet —
//     dues payments were completely non-functional, not just ungated.
//     Confirmed live before fixing: the newest group_wallet row's group_id
//     was NULL regardless of the group actually created.
//
//  2. PayDues called s.ledger.Debit directly with no tier gate at all, unlike
//     every other money-path module (restaurant, transport), which owe
//     CLAUDE.md's iron rule #4 a fail-closed KYC-tier / daily-limit check
//     before a wallet debit. Fixed by wiring the same tierLimiter seam
//     (EnforceCheckoutDebitLimit) restaurant/transport already use, refusing
//     with ErrTierGateUnwired when no gate is wired at all.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

func duesPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB dues test")
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

func seedGroupKYCTier(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, kycTier int) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,$3)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`, userID, userID+"@seed.test", kycTier); err != nil {
		t.Fatalf("seed kyc tier %d for %s: %v", kycTier, userID, err)
	}
}

// setupDuesGroup seeds a creator, a group (via the real Create — proving the
// group_id fix), and a ₦2,000/month subscription plan. Returns the group ID
// and plan ID.
func setupDuesGroup(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *Service, creator string) (groupID, planID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, creator, creator+"@seed.test"); err != nil {
		t.Fatalf("seed creator: %v", err)
	}
	testsupport.CleanupUser(t, pool, creator)

	g, err := svc.Create(ctx, creator, CreateGroupRequest{Name: "Dues Test Group " + uuid.New().String()})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}

	planID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO subscription_plans (id, group_id, name, amount_kobo, frequency, due_day) VALUES ($1,$2,'Monthly Dues',200000,'monthly',1)`,
		planID, g.ID); err != nil {
		t.Fatalf("seed plan: %v", err)
	}
	return g.ID, planID
}

func addGroupMember(t *testing.T, ctx context.Context, pool *pgxpool.Pool, groupID, userID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@seed.test"); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if _, err := pool.Exec(ctx, `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, groupID, userID); err != nil {
		t.Fatalf("add member: %v", err)
	}
}

// TestLiveDB_Create_GroupWalletIsFindableByPayDues pins bug #1: the group's
// wallet ledger account must actually be reachable by group_id, the same
// lookup PayDues performs, not silently orphaned with group_id NULL.
func TestLiveDB_Create_GroupWalletIsFindableByPayDues(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(pool, led)

	creator := uuid.New().String()
	groupID, _ := setupDuesGroup(t, ctx, pool, svc, creator)

	var walletID string
	err := pool.QueryRow(ctx, `SELECT id FROM ledger_accounts WHERE group_id=$1 AND type='group_wallet'`, groupID).Scan(&walletID)
	if err != nil {
		t.Fatalf("group wallet not found by group_id — Create() left it orphaned: %v", err)
	}
	if walletID == "" {
		t.Fatal("wallet id is empty")
	}
}

// TestLiveDB_PayDues_RejectsTier0ThenFundedMemberSucceeds pins bug #2: a
// Tier-0 (unverified, wallet-disabled) member must be refused BEFORE any
// money moves, and a properly-tiered, funded member must succeed once the
// gate is wired.
func TestLiveDB_PayDues_RejectsTier0ThenFundedMemberSucceeds(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	svc := NewService(pool, led).WithTiers(tiersSvc)

	creator := uuid.New().String()
	groupID, planID := setupDuesGroup(t, ctx, pool, svc, creator)

	// Tier 0 member: no user_profiles row at all — the strongest fail-closed case.
	unverified := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, unverified)

	_, err := svc.PayDues(ctx, groupID, unverified, PayDuesRequest{PlanID: planID, IdempotencyKey: "dues-" + uuid.New().String()})
	if err == nil {
		t.Fatal("expected Tier-0 member's dues payment to be refused")
	}
	if !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Errorf("err = %v, want wrapping tiers.ErrWalletDisabled", err)
	}
	var paymentCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM group_payments WHERE group_id=$1 AND member_id=$2`, groupID, unverified).Scan(&paymentCount); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	if paymentCount != 0 {
		t.Fatalf("refused dues payment still inserted %d group_payments row(s)", paymentCount)
	}

	// Funded Tier-1+ member: should succeed and actually move money.
	funded := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, funded)
	seedGroupKYCTier(t, ctx, pool, funded, 3)
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, funded, "seed-fund", "duesfund-"+funded, revAcc.ID, 1_000_000); err != nil {
		t.Fatalf("fund member: %v", err)
	}

	payment, err := svc.PayDues(ctx, groupID, funded, PayDuesRequest{PlanID: planID, IdempotencyKey: "dues-" + uuid.New().String()})
	if err != nil {
		t.Fatalf("funded member's dues payment: %v", err)
	}
	if payment.Status != "paid" {
		t.Errorf("status = %q, want paid", payment.Status)
	}

	var walletID string
	if err := pool.QueryRow(ctx, `SELECT id FROM ledger_accounts WHERE group_id=$1 AND type='group_wallet'`, groupID).Scan(&walletID); err != nil {
		t.Fatalf("find group wallet: %v", err)
	}
	var creditedKobo int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE account_id=$1 AND type='CREDIT'`, walletID).Scan(&creditedKobo); err != nil {
		t.Fatalf("sum group wallet credits: %v", err)
	}
	if creditedKobo != 200000 {
		t.Errorf("group wallet credited = %d kobo, want 200000 (the plan amount actually moved)", creditedKobo)
	}
}

// TestLiveDB_PayDues_NilTierGateRefusesRatherThanDebitingUngated pins the
// fail-closed convention itself: a Service with no tier gate wired must
// refuse every dues payment, not silently debit with no limit.
func TestLiveDB_PayDues_NilTierGateRefusesRatherThanDebitingUngated(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(pool, led) // no .WithTiers(...)

	creator := uuid.New().String()
	groupID, planID := setupDuesGroup(t, ctx, pool, svc, creator)

	member := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, member)
	seedGroupKYCTier(t, ctx, pool, member, 3)
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, member, "seed-fund", "unwiredfund-"+member, revAcc.ID, 1_000_000); err != nil {
		t.Fatalf("fund member: %v", err)
	}

	_, err = svc.PayDues(ctx, groupID, member, PayDuesRequest{PlanID: planID, IdempotencyKey: "dues-" + uuid.New().String()})
	if !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("err = %v, want ErrTierGateUnwired", err)
	}
}
