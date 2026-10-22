package app

// GAP-DEP-01 Slice 2b — the deposit reconciler end to end over the REAL schema. The domain
// tests in cryptosvc prove the sweep's control flow against the mock provider; this proves the
// money: the sweep enumerates provider sub-accounts from crypto_accounts, re-submits each mock
// deposit into the same once-only, confirmation-gated bridge settler the webhook uses, and the
// credit lands in crypto_holdings EXACTLY once. A second sweep finds the transfer already
// settled (the store's UNIQUE(provider_op_id)) and moves no balance — the reconciler is a pure
// safety net and can never double-credit. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
	"spotlight/backend/internal/cryptosvc"
	"spotlight/backend/internal/testsupport"
)

type alwaysLead struct{}

func (alwaysLead) TryLead(context.Context) (func(), bool, error) { return func() {}, true, nil }

func reconcilerPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping deposit reconciler live-DB test")
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

// seedReconcilerAccount creates an auth.users row + a quidax sub-account mapping.
func seedReconcilerAccount(t *testing.T, pool *pgxpool.Pool) (userID, providerAccountID string) {
	t.Helper()
	ctx := context.Background()
	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, u)
	acct := "acct-" + uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO crypto_accounts (user_id, provider, provider_account_id) VALUES ($1,$2,$3)`,
		u, "quidax", acct); err != nil {
		t.Fatalf("seed crypto_account: %v", err)
	}
	return u, acct
}

func reconcilerHoldings(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(h.units),0) FROM crypto_holdings h
		 JOIN crypto_assets a ON a.id = h.asset_id
		 WHERE h.user_id = $1 AND a.symbol = 'BTC'`, userID).Scan(&bal)
	if err != nil {
		t.Fatalf("read holdings: %v", err)
	}
	return bal
}

func confirmedMockDeposit(acct, op string, whole decimal.Decimal, confs int) cryptoprov.Deposit {
	return cryptoprov.Deposit{
		ID: op, AccountID: acct, Currency: "BTC", Network: "bitcoin", Address: "bc1q",
		Amount: whole, Confirmations: confs, Status: cryptoprov.DepositConfirmed, TxHash: "0x" + op,
	}
}

// TestDepositReconcilerCreditsOnceLive: sweep settles a missed webhook exactly once; a replayed
// sweep is a duplicate and never re-credits.
func TestDepositReconcilerCreditsOnceLive(t *testing.T) {
	pool := reconcilerPool(t)
	ctx := context.Background()
	user, acct := seedReconcilerAccount(t, pool)

	mock := cryptoprov.NewMock("quidax", func() time.Time { return time.Unix(0, 0).UTC() })
	op := uuid.NewString()
	mock.AddDeposit(confirmedMockDeposit(acct, op, decimal.RequireFromString("0.005"), 6)) // 500000 minor

	reg := cryptoprov.NewRegistry("quidax")
	if err := reg.Register(mock); err != nil {
		t.Fatalf("register mock: %v", err)
	}

	r := cryptosvc.NewDepositReconciler(cryptosvc.DepositReconcilerConfig{
		ProviderName: "quidax",
		Registry:     reg,
		Settler:      newCryptoDepositSettler(pool, 2), // floor of 2; confs 6 clears it
		Accounts:     &cryptosvc.PgDepositAccountSource{Pool: pool},
		Leader:       alwaysLead{},
	})

	res, err := r.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.Settled != 1 {
		t.Fatalf("first sweep must settle exactly our deposit, got %+v", res)
	}
	if bal := reconcilerHoldings(t, pool, user); bal != 500_000 {
		t.Fatalf("balance=%d want 500000 (0.005 BTC at scale 1e8)", bal)
	}

	// Second sweep: same provider op id already journaled — duplicate, zero balance movement.
	res2, err := r.RunOnce(ctx)
	if err != nil {
		t.Fatalf("second RunOnce: %v", err)
	}
	if res2.Duplicates != 1 || res2.Settled != 0 {
		t.Fatalf("second sweep must report 1 duplicate / 0 settled, got %+v", res2)
	}
	if bal := reconcilerHoldings(t, pool, user); bal != 500_000 {
		t.Fatalf("balance after replay=%d want 500000 (the reconciler must never double-credit)", bal)
	}

	var journaled int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM crypto_deposits WHERE provider_op_id=$1`, op).Scan(&journaled); err != nil {
		t.Fatalf("count journal: %v", err)
	}
	if journaled != 1 {
		t.Fatalf("journal rows=%d want 1", journaled)
	}
}

// TestDepositReconcilerParksUnderConfirmed: a transfer delivered below the confirmation floor
// is not credited; once it reaches the floor a later sweep settles it.
func TestDepositReconcilerParksUnderConfirmed(t *testing.T) {
	pool := reconcilerPool(t)
	ctx := context.Background()
	user, acct := seedReconcilerAccount(t, pool)

	mock := cryptoprov.NewMock("quidax", func() time.Time { return time.Unix(0, 0).UTC() })
	op := uuid.NewString()
	mock.AddDeposit(confirmedMockDeposit(acct, op, decimal.RequireFromString("0.002"), 1)) // below floor 2

	reg := cryptoprov.NewRegistry("quidax")
	if err := reg.Register(mock); err != nil {
		t.Fatalf("register mock: %v", err)
	}
	r := cryptosvc.NewDepositReconciler(cryptosvc.DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg,
		Settler:  newCryptoDepositSettler(pool, 2),
		Accounts: &cryptosvc.PgDepositAccountSource{Pool: pool},
		Leader:   alwaysLead{},
	})

	if res, err := r.RunOnce(ctx); err != nil || res.Awaiting != 1 || res.Settled != 0 {
		t.Fatalf("under-floor sweep: %+v err=%v want 1 awaiting / 0 settled", res, err)
	}
	if bal := reconcilerHoldings(t, pool, user); bal != 0 {
		t.Fatalf("balance=%d want 0 (below floor must not credit)", bal)
	}

	// The provider finalises it past the floor; the next sweep settles it.
	if err := mock.ConfirmDeposit(op, cryptoprov.DepositConfirmed, 4); err != nil {
		t.Fatalf("confirm deposit: %v", err)
	}
	if res, err := r.RunOnce(ctx); err != nil || res.Settled != 1 {
		t.Fatalf("after confirmations reached the floor: %+v err=%v want 1 settled", res, err)
	}
	if bal := reconcilerHoldings(t, pool, user); bal != 200_000 {
		t.Fatalf("balance=%d want 200000 (0.002 BTC at scale 1e8)", bal)
	}
}
