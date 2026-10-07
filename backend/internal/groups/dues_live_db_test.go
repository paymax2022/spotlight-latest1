package groups

// LIVE-DB regression guard for the GRP-4 dues money path. Two invariants:
//  1. Create() must bind the group's wallet ledger account with group_id —
//     PayDues looks the wallet up by group_id, so a NULL group_id leaves every
//     group's wallet unreachable.
//  2. PayDues must pass a fail-closed KYC-tier / daily-limit check before the
//     wallet debit (CLAUDE.md iron rule #4), via the same tierLimiter seam
//     (EnforceCheckoutDebitLimit) restaurant/transport use — refusing with
//     ErrTierGateUnwired when no gate is wired at all.
// Skipped unless TEST_DATABASE_URL is set.

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

// TestLiveDB_PayDues_CrossMemberKeyCollision_Refused pins the S2 phantom-pay
// wedge: member A paid dues under key K; member B reusing K at the same plan
// amount must be REFUSED. The ledger's replay check only compares amount
// under the key — without the account+key+amount verify, B's debit would
// silently no-op on A's legs while group_payments recorded B as 'paid'.
func TestLiveDB_PayDues_CrossMemberKeyCollision_Refused(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	svc := NewService(pool, led).WithTiers(tiersSvc)

	creator := uuid.New().String()
	groupID, planID := setupDuesGroup(t, ctx, pool, svc, creator)

	alice := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, alice)
	seedGroupKYCTier(t, ctx, pool, alice, 3)
	bob := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, bob)
	seedGroupKYCTier(t, ctx, pool, bob, 3)

	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	for _, u := range []string{alice, bob} {
		if err := led.Credit(ctx, u, "seed-fund", "duesfund-"+u, revAcc.ID, 1_000_000); err != nil {
			t.Fatalf("fund %s: %v", u, err)
		}
	}

	key := "dues-shared-" + uuid.New().String()
	if _, err := svc.PayDues(ctx, groupID, alice, PayDuesRequest{PlanID: planID, IdempotencyKey: key}); err != nil {
		t.Fatalf("alice dues: %v", err)
	}
	if _, err := svc.PayDues(ctx, groupID, bob, PayDuesRequest{PlanID: planID, IdempotencyKey: key}); err == nil {
		t.Fatal("bob's colliding dues succeeded — a same-amount key collision on another member's account must be refused, not phantom-paid")
	}
	if bal, _ := led.GetBalance(ctx, bob); bal != 1_000_000 {
		t.Fatalf("bob balance = %d, want 1000000 — a refused dues attempt must never debit", bal)
	}
	var bobRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM group_payments WHERE member_id=$1`, bob).Scan(&bobRows); err != nil {
		t.Fatalf("count bob payments: %v", err)
	}
	if bobRows != 0 {
		t.Fatalf("bob recorded %d payment row(s) without paying — phantom 'paid' row", bobRows)
	}
}

// TestLiveDB_PayDues_CrossRailJournal_NoAbsorption proves the namespaced
// journal key ("groups:dues:") works the other direction too: a same-amount
// journal another rail posted under the SAME raw key can no longer absorb
// the dues debit — the member is really debited and really paid.
func TestLiveDB_PayDues_CrossRailJournal_NoAbsorption(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	svc := NewService(pool, led).WithTiers(tiersSvc)

	creator := uuid.New().String()
	groupID, planID := setupDuesGroup(t, ctx, pool, svc, creator)

	member := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, member)
	seedGroupKYCTier(t, ctx, pool, member, 3)

	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, member, "seed-fund", "duesfund-"+member, revAcc.ID, 1_000_000); err != nil {
		t.Fatalf("fund member: %v", err)
	}

	// A foreign rail posts a journal under the raw caller key at the same
	// amount — under the old raw-key wiring this is what silently absorbed
	// the dues debit (the phantom-pay path).
	key := "dues-" + uuid.New().String()
	if err := led.Debit(ctx, member, "xfer:foreign", key, revAcc.ID, 200_000); err != nil {
		t.Fatalf("foreign journal: %v", err)
	}

	payment, err := svc.PayDues(ctx, groupID, member, PayDuesRequest{PlanID: planID, IdempotencyKey: key})
	if err != nil {
		t.Fatalf("dues after foreign journal err = %v, want nil (namespaced key must not be absorbed)", err)
	}
	if payment.Status != "paid" {
		t.Fatalf("status = %q, want paid", payment.Status)
	}
	if bal, _ := led.GetBalance(ctx, member); bal != 600_000 {
		t.Fatalf("member balance = %d, want 600000 — the dues debit must have really posted, not been absorbed by the foreign journal", bal)
	}
}

// TestLiveDB_PayDues_SameMemberReplay_ReturnsRecordedPayment: a retry of the
// same member's key returns the recorded payment — no second debit, no error.
func TestLiveDB_PayDues_SameMemberReplay_ReturnsRecordedPayment(t *testing.T) {
	pool := duesPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	svc := NewService(pool, led).WithTiers(tiersSvc)

	creator := uuid.New().String()
	groupID, planID := setupDuesGroup(t, ctx, pool, svc, creator)

	member := uuid.New().String()
	addGroupMember(t, ctx, pool, groupID, member)
	seedGroupKYCTier(t, ctx, pool, member, 3)
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, member, "seed-fund", "duesfund-"+member, revAcc.ID, 1_000_000); err != nil {
		t.Fatalf("fund member: %v", err)
	}

	key := "dues-" + uuid.New().String()
	first, err := svc.PayDues(ctx, groupID, member, PayDuesRequest{PlanID: planID, IdempotencyKey: key})
	if err != nil {
		t.Fatalf("first dues: %v", err)
	}
	second, err := svc.PayDues(ctx, groupID, member, PayDuesRequest{PlanID: planID, IdempotencyKey: key})
	if err != nil {
		t.Fatalf("replay dues err = %v, want nil (same member, same key)", err)
	}
	if first.ID != second.ID {
		t.Fatalf("replay returned payment %s, want recorded payment %s", second.ID, first.ID)
	}
	if bal, _ := led.GetBalance(ctx, member); bal != 800_000 {
		t.Fatalf("member balance = %d, want 800000 (exactly one dues debit)", bal)
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
