package savings

// LIVE-DB regression tests for E2E-FIN-041: savings debits called
// ledger.Service.Debit DIRECTLY, bypassing tiers.EnforceWalletDebitLimit — a
// kyc_tier=0 member could deposit into a vault / fund a target / pay an Ajo
// leg while /api/finance/transfers/paymax 403'd the same wallet. Each test
// proves:
//   1. a Tier-0 member is refused with tiers.ErrWalletDisabled;
//   2. the refusal posts ZERO ledger legs (the gate runs BEFORE money moves);
//   3. the same request at Tier ≥1 succeeds.
// The Ajo cycle test proves the per-member gate inside RunCycle: a tier-0
// member's leg is refused (→ DEFAULTED, the existing shortfall path) while the
// funded member's leg still collects — the gate must not stall the ring.
// ⚠️ GATED ON TEST_DATABASE_URL WITH NO FALLBACK TO DATABASE_URL — the root
// .env points DATABASE_URL at the PRODUCTION Supabase pooler and these tests
// move money. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/savings/ -run 'TestLiveDB_Tier' -v

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// setKycTier sets the tier the gate reads (user_profiles.kyc_tier) — the same
// technique the e2e harness uses (tests/e2e/provider/helpers.ts setKycTier).
func setKycTier(t *testing.T, pool *pgxpool.Pool, userID string, tier int) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,$3)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`,
		userID, userID+"@seed.test", tier); err != nil {
		t.Fatalf("set kyc_tier=%d for %s: %v", tier, userID, err)
	}
}

// fundWallet credits the member's wallet with ₦5,000 from provider-clearing so
// they have something to (attempt to) move.
func fundWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string) {
	t.Helper()
	clearing, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("resolve clearing account: %v", err)
	}
	key := "test:fund:" + uuid.NewString()
	if err := led.Credit(ctx, userID, key, key, clearing.ID, 5_000_00); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

// ledgerLegs counts entries whose idempotency key carries the attempt's key —
// a REFUSED attempt must leave ZERO.
func ledgerLegs(t *testing.T, pool *pgxpool.Pool, key string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, key+"%").Scan(&n); err != nil {
		t.Fatalf("count ledger legs: %v", err)
	}
	return n
}

func savingsLedger(pool *pgxpool.Pool) *ledger.Service {
	return ledger.NewService(ledger.NewRepository(pool), nil)
}

func TestLiveDB_TierGate_VaultDeposit(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	led := savingsLedger(pool)
	svc := NewVaultService(pool, led, nil, nil)

	owner := newTestOwner(t, pool)
	vaultID := seedVault(t, pool, owner, "tier-gated", nil)
	fundWallet(t, ctx, led, owner)
	setKycTier(t, pool, owner, 0)

	depositRef := "e2e-fin-041-deposit-" + uuid.NewString()

	// Tier 0 (wallet disabled): refused, ZERO ledger legs, vault stays empty.
	if _, err := svc.Deposit(ctx, owner, vaultID, 1_000_00, depositRef); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 deposit err = %v, want tiers.ErrWalletDisabled", err)
	}
	if n := ledgerLegs(t, pool, depositRef); n != 0 {
		t.Fatalf("tier-0 refusal posted %d ledger legs — the gate must run BEFORE money moves", n)
	}
	if bal, _ := svc.Balance(ctx, vaultID); bal != 0 {
		t.Fatalf("vault balance = %d after refused deposit, want 0", bal)
	}

	// Tier ≥1: the SAME reference now succeeds — the refusal consumed nothing.
	setKycTier(t, pool, owner, 1)
	if bal, err := svc.Deposit(ctx, owner, vaultID, 1_000_00, depositRef); err != nil || bal != 1_000_00 {
		t.Fatalf("tier-1 deposit bal=%d err=%v, want 100000/nil", bal, err)
	}
}

func TestLiveDB_TierGate_TargetContribute(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	led := savingsLedger(pool)
	svc := NewTargetService(pool, led, nil)

	creator := newTestOwner(t, pool)
	member := newTestOwner(t, pool)
	setKycTier(t, pool, creator, 1)
	future := time.Now().Add(24 * time.Hour) // ON_DATE requires a target date
	gt, err := svc.Create(ctx, creator, "pot", 5_000_00, RuleOnDate, &future)
	if err != nil {
		t.Fatalf("create target: %v", err)
	}
	if err := svc.Join(ctx, gt.ID, member); err != nil {
		t.Fatalf("join target: %v", err)
	}
	fundWallet(t, ctx, led, member)
	setKycTier(t, pool, member, 0)

	key := "e2e-fin-041-target-" + uuid.NewString()
	if _, err := svc.Contribute(ctx, gt.ID, member, 250_00, key); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 contribute err = %v, want tiers.ErrWalletDisabled", err)
	}
	if n := ledgerLegs(t, pool, key); n != 0 {
		t.Fatalf("tier-0 refusal posted %d ledger legs", n)
	}
	if bal, _ := svc.Balance(ctx, gt.ID); bal != 0 {
		t.Fatalf("pot balance = %d after refused contribution, want 0", bal)
	}

	setKycTier(t, pool, member, 1)
	if bal, err := svc.Contribute(ctx, gt.ID, member, 250_00, key); err != nil || bal != 250_00 {
		t.Fatalf("tier-1 contribute bal=%d err=%v, want 25000/nil", bal, err)
	}
}

func TestLiveDB_TierGate_AjoContributeAndMakeGood(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	led := savingsLedger(pool)
	svc := NewAjoService(pool, led, nil, nil) // nil scheduler — cycle runner unused here

	creator := newTestOwner(t, pool)
	member := newTestOwner(t, pool)
	setKycTier(t, pool, creator, 1)
	setKycTier(t, pool, member, 1)

	circle, err := svc.CreateCircle(ctx, creator, "ring", 100_00, 86400)
	if err != nil {
		t.Fatalf("create circle: %v", err)
	}
	if _, err := svc.Join(ctx, circle.ID, member); err != nil {
		t.Fatalf("join circle: %v", err)
	}
	if err := svc.Activate(ctx, creator, circle.ID); err != nil {
		t.Fatalf("activate circle: %v", err)
	}
	fundWallet(t, ctx, led, member)
	setKycTier(t, pool, member, 0)

	// Proactive prepay (AjoService.Contribute) must be refused at tier 0.
	key := "e2e-fin-041-ajo-" + uuid.NewString()
	if err := svc.Contribute(ctx, circle.ID, member, key); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 ajo contribute err = %v, want tiers.ErrWalletDisabled", err)
	}
	if n := ledgerLegs(t, pool, key); n != 0 {
		t.Fatalf("tier-0 refusal posted %d ledger legs", n)
	}

	// MakeGood must be refused the same way.
	mkey := "e2e-fin-041-makegood-" + uuid.NewString()
	if err := svc.MakeGood(ctx, circle.ID, member, 1, mkey); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 make-good err = %v, want tiers.ErrWalletDisabled", err)
	}
	if n := ledgerLegs(t, pool, mkey); n != 0 {
		t.Fatalf("tier-0 refusal posted %d ledger legs", n)
	}

	setKycTier(t, pool, member, 1)
	if err := svc.Contribute(ctx, circle.ID, member, key); err != nil {
		t.Fatalf("tier-1 ajo contribute err = %v, want nil", err)
	}
}

func TestLiveDB_TierGate_AjoRunCycle_PerMemberGate(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	led := savingsLedger(pool)
	svc := NewAjoService(pool, led, nil, nil)

	creator := newTestOwner(t, pool) // rotation 0 → cycle-1 recipient
	member := newTestOwner(t, pool)
	setKycTier(t, pool, creator, 1)
	setKycTier(t, pool, member, 0) // wallet disabled mid-ring

	circle, err := svc.CreateCircle(ctx, creator, "ring", 100_00, 86400)
	if err != nil {
		t.Fatalf("create circle: %v", err)
	}
	if _, err := svc.Join(ctx, circle.ID, member); err != nil {
		t.Fatalf("join circle: %v", err)
	}
	if err := svc.Activate(ctx, creator, circle.ID); err != nil {
		t.Fatalf("activate circle: %v", err)
	}
	fundWallet(t, ctx, led, creator)
	fundWallet(t, ctx, led, member)

	// The cycle debits each member; the tier-0 member's leg must be refused
	// (→ DEFAULTED) while the funded tier-1 creator's leg still collects.
	if err := svc.RunCycle(ctx, circle.ID, "e2e-fin-041-cycle-"+uuid.NewString()); err != nil {
		t.Fatalf("RunCycle err = %v, want nil (a refused member defaults, it must not stall the ring)", err)
	}
	var memberState string
	if err := pool.QueryRow(ctx,
		`SELECT state FROM ajo_members WHERE circle_id=$1 AND user_id=$2`, circle.ID, member).Scan(&memberState); err != nil {
		t.Fatalf("read member state: %v", err)
	}
	if memberState != "DEFAULTED" {
		t.Fatalf("tier-0 member state = %q, want DEFAULTED (their debit was refused)", memberState)
	}
	// Recipient (creator) receives ONLY what was actually collected — their own
	// sole contribution straight back, never the full ring (NL-1/NL-7). Funded
	// 500_000 kobo, debited 10_000, credited 10_000 collected → net unchanged.
	if bal, _ := led.GetBalance(ctx, creator); bal != 5_000_00 {
		t.Fatalf("creator balance = %d, want 500000", bal)
	}
}

func TestLiveDB_TierGate_UnwiredServiceFailsClosed(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	led := savingsLedger(pool)

	owner := newTestOwner(t, pool)
	vaultID := seedVault(t, pool, owner, "unwired", nil)
	fundWallet(t, ctx, led, owner)
	setKycTier(t, pool, owner, 3)

	// Struct-literal construction (as older tests did) leaves tiers nil — the
	// money path must REFUSE rather than debit ungated.
	svc := &VaultService{db: pool, led: led}
	key := "e2e-fin-041-unwired-" + uuid.NewString()
	if _, err := svc.Deposit(ctx, owner, vaultID, 1_000_00, key); !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("unwired deposit err = %v, want ErrTierGateUnwired (fail closed)", err)
	}
	if n := ledgerLegs(t, pool, key); n != 0 {
		t.Fatalf("unwired service posted %d ledger legs — must never debit ungated", n)
	}
}

// Compile-time guard: *tiers.Service must satisfy the seam app wiring installs.
var _ walletDebitLimiter = (*tiers.Service)(nil)
