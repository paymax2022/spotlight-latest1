package social

// LIVE-DB regression tests for E2E-FIN-041: the Social Pay debits (cashtag
// Send, PayRequest, PayShare, ContributePool) called ledger.Service.Debit
// DIRECTLY, bypassing tiers.EnforceWalletDebitLimit — a kyc_tier=0 user could
// send ₦1,000 and fund a pool while /api/finance/transfers/paymax 403'd the
// same wallet. Each test proves:
//   1. a Tier-0 caller is refused with tiers.ErrWalletDisabled;
//   2. the refusal posts ZERO ledger legs (the gate runs BEFORE money moves);
//   3. the same request re-sent at Tier ≥1 succeeds — so the refusal did not
//      consume the idempotency key or flip any state.
// ⚠️ GATED ON TEST_DATABASE_URL WITH NO FALLBACK TO DATABASE_URL — the root
// .env points DATABASE_URL at the PRODUCTION Supabase pooler and these tests
// move money. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/social/ -run 'TestLiveDB_' -v

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

// socialTestPool dials the LOCAL test database, or skips.
func socialTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB social test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// socialTestUser creates a throwaway auth.users row; the trigger mirrors it
// into user_profiles (kyc_tier default 0 — the disabled-wallet tier).
func socialTestUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "social-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

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

// fundWallet credits the user from the provider-clearing standing account —
// a balance the sender can then (attempt to) spend.
func fundWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, kobo int64) {
	t.Helper()
	clearing, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("resolve clearing account: %v", err)
	}
	key := "test:fund:" + uuid.NewString()
	if err := led.Credit(ctx, userID, key, key, clearing.ID, kobo); err != nil {
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

func socialService(pool *pgxpool.Pool) *Service {
	return NewService(pool, ledger.NewService(ledger.NewRepository(pool), nil),
		cashtag.NewService(pool), NewAML(pool, DefaultAMLConfig()), nil)
}

func TestLiveDB_SocialSend_Tier0Refused_Tier1Succeeds(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)
	tags := cashtag.NewService(pool)

	sender := socialTestUser(t, pool)
	recipient := socialTestUser(t, pool)
	setKycTier(t, pool, recipient, 1)
	handle := "rcpt" + uuid.NewString()[:8]
	if _, err := tags.Claim(ctx, recipient, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	fundWallet(t, ctx, led, sender, 10_000_00) // ₦10,000 funded
	setKycTier(t, pool, sender, 0)

	key := "e2e-fin-041-send-" + uuid.NewString()

	// Tier 0 (wallet disabled): refused, ZERO ledger legs, balance untouched.
	if _, err := svc.Send(ctx, sender, handle, "t", key, 1_000_00); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 send err = %v, want tiers.ErrWalletDisabled", err)
	}
	if n := ledgerLegs(t, pool, key); n != 0 {
		t.Fatalf("tier-0 refusal posted %d ledger legs — the gate must run BEFORE money moves", n)
	}
	if bal, _ := led.GetBalance(ctx, sender); bal != 10_000_00 {
		t.Fatalf("sender balance = %d after refused send, want 1000000", bal)
	}

	// Tier ≥1: the SAME key now succeeds — the refusal consumed nothing.
	setKycTier(t, pool, sender, 1)
	p, err := svc.Send(ctx, sender, handle, "t", key, 1_000_00)
	if err != nil {
		t.Fatalf("tier-1 send err = %v, want nil", err)
	}
	if p.RecipientID != recipient {
		t.Fatalf("recipient = %s, want %s", p.RecipientID, recipient)
	}
	if bal, _ := led.GetBalance(ctx, recipient); bal != 1_000_00 {
		t.Fatalf("recipient balance = %d, want 100000", bal)
	}
}

func TestLiveDB_SocialPayRequest_Tier0Refused_StaysPending(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)
	tags := cashtag.NewService(pool)

	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, requester, 1)
	handle := "pyr" + uuid.NewString()[:8]
	if _, err := tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, handle, "owed", 500_00)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	fundWallet(t, ctx, led, payer, 5_000_00)
	setKycTier(t, pool, payer, 0)

	// Tier 0 must be refused BEFORE the PENDING→PAID flip — a refused attempt
	// that still marks the request paid would silently erase a collectible debt.
	if err := svc.PayRequest(ctx, payer, req.ID); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 pay request err = %v, want tiers.ErrWalletDisabled", err)
	}
	if n := ledgerLegs(t, pool, "req:"+req.ID); n != 0 {
		t.Fatalf("tier-0 refusal posted %d ledger legs", n)
	}
	got, err := svc.getRequest(ctx, req.ID)
	if err != nil || got.State != RequestPending {
		t.Fatalf("request state = %v err=%v after refusal, want PENDING", got, err)
	}

	setKycTier(t, pool, payer, 1)
	if err := svc.PayRequest(ctx, payer, req.ID); err != nil {
		t.Fatalf("tier-1 pay request err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, requester); bal != 500_00 {
		t.Fatalf("requester balance = %d, want 50000", bal)
	}
}

func TestLiveDB_SocialPayShare_Tier0Refused_StaysPending(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)
	tags := cashtag.NewService(pool)

	organiser := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	handle := "shr" + uuid.NewString()[:8]
	if _, err := tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	_, shares, err := svc.CreateSplit(ctx, organiser, "dinner", 800_00, SplitCustom,
		[]ShareInput{{Handle: handle, AmountKobo: 800_00}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}
	if len(shares) != 1 {
		t.Fatalf("want 1 share, got %d", len(shares))
	}
	shareID := shares[0].ID
	fundWallet(t, ctx, led, payer, 5_000_00)
	setKycTier(t, pool, payer, 0)

	key := "e2e-fin-041-share-" + uuid.NewString()
	if err := svc.PayShare(ctx, payer, shareID, key); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 pay share err = %v, want tiers.ErrWalletDisabled", err)
	}
	if n := ledgerLegs(t, pool, key); n != 0 {
		t.Fatalf("tier-0 refusal posted %d ledger legs", n)
	}
	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM split_shares WHERE id=$1`, shareID).Scan(&state); err != nil {
		t.Fatalf("read share state: %v", err)
	}
	if state != "PENDING" {
		t.Fatalf("share state = %q after refusal, want PENDING", state)
	}

	setKycTier(t, pool, payer, 1)
	if err := svc.PayShare(ctx, payer, shareID, key); err != nil {
		t.Fatalf("tier-1 pay share err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 800_00 {
		t.Fatalf("organiser balance = %d, want 80000", bal)
	}
}

func TestLiveDB_SocialContributePool_Tier0Refused_Tier1Succeeds(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	contributor := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	p, err := svc.CreatePool(ctx, organiser, "trip", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	fundWallet(t, ctx, led, contributor, 5_000_00)
	setKycTier(t, pool, contributor, 0)

	key := "e2e-fin-041-pool-" + uuid.NewString()
	if _, err := svc.ContributePool(ctx, contributor, p.ID, 250_00, key); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 contribute err = %v, want tiers.ErrWalletDisabled", err)
	}
	if n := ledgerLegs(t, pool, key); n != 0 {
		t.Fatalf("tier-0 refusal posted %d ledger legs", n)
	}
	if bal, _ := svc.PoolBalance(ctx, p.ID); bal != 0 {
		t.Fatalf("pool balance = %d after refused contribution, want 0", bal)
	}

	setKycTier(t, pool, contributor, 1)
	if bal, err := svc.ContributePool(ctx, contributor, p.ID, 250_00, key); err != nil || bal != 250_00 {
		t.Fatalf("tier-1 contribute bal=%d err=%v, want 25000/nil", bal, err)
	}
}

func TestLiveDB_SocialSend_NoGateWiredFailsClosed(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := &Service{db: pool, led: led, tags: cashtag.NewService(pool), aml: NewAML(pool, DefaultAMLConfig())} // tiers nil

	sender := socialTestUser(t, pool)
	recipient := socialTestUser(t, pool)
	handle := "nog" + uuid.NewString()[:8]
	if _, err := svc.tags.Claim(ctx, recipient, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	fundWallet(t, ctx, led, sender, 10_000_00)
	setKycTier(t, pool, sender, 3)

	key := "e2e-fin-041-unwired-" + uuid.NewString()
	if _, err := svc.Send(ctx, sender, handle, "t", key, 1_000_00); !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("unwired send err = %v, want ErrTierGateUnwired (fail closed)", err)
	}
	if n := ledgerLegs(t, pool, key); n != 0 {
		t.Fatalf("unwired service posted %d ledger legs — must never debit ungated", n)
	}
}

// Compile-time guard: the service must satisfy the real limiter interface with
// *tiers.Service so app wiring (RegisterSocialPay → NewService) is covered.
var _ walletDebitLimiter = (*tiers.Service)(nil)
