package deposit

// Live-DB tests for the deposit path: the real crypto_deposits journal + crypto_holdings
// projection + crypto_accounts/crypto_assets resolution over Postgres. SKIPPED unless
// TEST_DATABASE_URL is set. crypto_deposits.provider_op_id is UNIQUE and the tables are
// shared, so assertions are on the delta a test's own operation ids cause.

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
	"spotlight/backend/internal/testsupport"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping deposit live-DB test")
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

// seedUser creates an auth.users row + a provider sub-account mapping and returns
// (userID, providerAccountID). Teardown cascades via testsupport.CleanupUser.
func seedUser(t *testing.T, pool *pgxpool.Pool, provider string) (string, string) {
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
		u, provider, acct); err != nil {
		t.Fatalf("seed crypto_account: %v", err)
	}
	return u, acct
}

func btcAssetID(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM crypto_assets WHERE symbol='BTC' AND is_active LIMIT 1`).Scan(&id); err != nil {
		t.Fatalf("BTC asset must exist in the dev DB: %v", err)
	}
	return id
}

func newSettler(pool *pgxpool.Pool, defaultConfs int) *Settler {
	conf := StaticPolicy{ByNetwork: map[string]int{"bitcoin": defaultConfs}, Default: defaultConfs}
	return NewSettler(NewDBResolver(pool, conf), NewPGStore(pool))
}

func credit(acct, op string, units int64, confs int) Credit {
	return Credit{
		Provider: "quidax", ProviderAccountID: acct, ProviderOpID: op,
		Symbol: "BTC", Network: "bitcoin", Address: "bc1q", Units: units,
		Confirmations: confs, Status: StatusConfirmed, TxHash: "0x" + op,
	}
}

func TestLive_ConfirmedDepositCreditsHoldingsOnce(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	u, acct := seedUser(t, pool, "quidax")
	asset := btcAssetID(t, pool)
	s := newSettler(pool, 2)

	op := uuid.NewString()
	if res, err := s.Settle(ctx, credit(acct, op, 500_000, 3)); err != nil || res.Outcome != OutcomeSettled {
		t.Fatalf("first settle: outcome=%s err=%v", res.Outcome, err)
	}
	bal, _ := Balance(ctx, pool, u, asset)
	if bal != 500_000 {
		t.Fatalf("balance=%d want 500000", bal)
	}

	// Replay the same operation id: duplicate, no balance movement.
	if res, err := s.Settle(ctx, credit(acct, op, 500_000, 4)); err != nil || res.Outcome != OutcomeDuplicate {
		t.Fatalf("replay: outcome=%s err=%v", res.Outcome, err)
	}
	bal, _ = Balance(ctx, pool, u, asset)
	if bal != 500_000 {
		t.Fatalf("balance after replay=%d want 500000 (must not double-credit)", bal)
	}
}

func TestLive_ConcurrentSameOpIdCreditsOnce(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	u, acct := seedUser(t, pool, "quidax")
	asset := btcAssetID(t, pool)
	s := newSettler(pool, 2)
	op := uuid.NewString()

	var wg sync.WaitGroup
	settled, dup := 0, 0
	var mu sync.Mutex
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := s.Settle(ctx, credit(acct, op, 250_000, 5))
			if err != nil {
				t.Errorf("settle: %v", err)
				return
			}
			mu.Lock()
			switch res.Outcome {
			case OutcomeSettled:
				settled++
			case OutcomeDuplicate:
				dup++
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	if settled != 1 {
		t.Fatalf("settled=%d want exactly 1 (provider_op_id UNIQUE race)", settled)
	}
	if dup != 15 {
		t.Fatalf("dup=%d want 15", dup)
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 250_000 {
		t.Fatalf("balance=%d want 250000 (no double-spend)", bal)
	}
}

func TestLive_CrossTenantIsolation(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	uA, acctA := seedUser(t, pool, "quidax")
	uB, acctB := seedUser(t, pool, "quidax")
	asset := btcAssetID(t, pool)
	s := newSettler(pool, 1)

	if res, _ := s.Settle(ctx, credit(acctA, uuid.NewString(), 900, 2)); res.Outcome != OutcomeSettled {
		t.Fatalf("A settle outcome=%s", res.Outcome)
	}
	if res, _ := s.Settle(ctx, credit(acctB, uuid.NewString(), 111, 2)); res.Outcome != OutcomeSettled {
		t.Fatalf("B settle outcome=%s", res.Outcome)
	}
	aBal, _ := Balance(ctx, pool, uA, asset)
	bBal, _ := Balance(ctx, pool, uB, asset)
	if aBal != 900 || bBal != 111 {
		t.Fatalf("isolation broken: A=%d want 900, B=%d want 111", aBal, bBal)
	}
}

func TestLive_OrphanAccountCreditsNobody(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	s := newSettler(pool, 1)
	res, err := s.Settle(ctx, credit("no-such-account-"+uuid.NewString(), uuid.NewString(), 1000, 3))
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if res.Outcome != OutcomeUnmapped {
		t.Fatalf("outcome=%s want unmapped", res.Outcome)
	}
}

func TestLive_AwaitsConfirmationsAndWritesNoRow(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	u, acct := seedUser(t, pool, "quidax")
	asset := btcAssetID(t, pool)
	s := newSettler(pool, 6) // require 6
	op := uuid.NewString()
	res, _ := s.Settle(ctx, credit(acct, op, 777, 3)) // only 3 confs
	if res.Outcome != OutcomeAwaiting {
		t.Fatalf("outcome=%s want awaiting", res.Outcome)
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 0 {
		t.Fatalf("balance=%d want 0 (below threshold must not credit)", bal)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM crypto_deposits WHERE provider_op_id=$1`, op).Scan(&n)
	if n != 0 {
		t.Fatalf("awaiting deposit must not write a journal row, found %d", n)
	}
}

// providerDeposit builds the authoritative re-queried transfer a webhook settles from. The
// amount is in WHOLE asset units; the engine converts it to minor units via crypto_assets.
func liveProviderDeposit(acct, op string, amount decimal.Decimal, confs int, status cryptoprov.DepositStatus) cryptoprov.Deposit {
	return cryptoprov.Deposit{
		ID: op, AccountID: acct, Currency: "BTC", Network: "bitcoin", Address: "bc1q",
		Amount: amount, Confirmations: confs, Status: status, TxHash: "0x" + op,
	}
}

// SettleDeposit over the real schema: a 0.005 BTC transfer becomes 500000 minor units, is
// journaled once, and a replay never double-credits.
func TestLive_ProviderDepositSettlesWithScale(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	u, acct := seedUser(t, pool, "quidax")
	asset := btcAssetID(t, pool)
	s := newSettler(pool, 2)
	op := uuid.NewString()

	d := liveProviderDeposit(acct, op, decimal.RequireFromString("0.005"), 3, cryptoprov.DepositConfirmed)
	if res, err := s.SettleDeposit(ctx, "quidax", d); err != nil || res.Outcome != OutcomeSettled {
		t.Fatalf("first settle: outcome=%s err=%v", res.Outcome, err)
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 500_000 {
		t.Fatalf("balance=%d want 500000 (0.005 BTC at scale 1e8)", bal)
	}
	var journaled int64
	_ = pool.QueryRow(ctx, `SELECT units FROM crypto_deposits WHERE provider_op_id=$1`, op).Scan(&journaled)
	if journaled != 500_000 {
		t.Fatalf("journal units=%d want 500000", journaled)
	}

	// Replay the same provider operation id: duplicate, no movement.
	if res, err := s.SettleDeposit(ctx, "quidax", d); err != nil || res.Outcome != OutcomeDuplicate {
		t.Fatalf("replay: outcome=%s err=%v", res.Outcome, err)
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 500_000 {
		t.Fatalf("balance after replay=%d want 500000", bal)
	}
}

func TestLive_ProviderDepositDustAndUnmappedCreditNobody(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	u, acct := seedUser(t, pool, "quidax")
	asset := btcAssetID(t, pool)
	s := newSettler(pool, 1)

	// Sub-minor-unit dust cannot be represented: refused, no row, no credit.
	dust := liveProviderDeposit(acct, "dust-"+uuid.NewString(), decimal.RequireFromString("0.000000004"), 3, cryptoprov.DepositConfirmed)
	if res, _ := s.SettleDeposit(ctx, "quidax", dust); res.Outcome != OutcomeRejected {
		t.Fatalf("dust outcome=%s want rejected", res.Outcome)
	}
	// A pending transfer credits nothing.
	pending := liveProviderDeposit(acct, "pend-"+uuid.NewString(), decimal.NewFromInt(1), 3, cryptoprov.DepositPending)
	if res, _ := s.SettleDeposit(ctx, "quidax", pending); res.Outcome != OutcomeAwaiting {
		t.Fatalf("pending outcome=%s want awaiting", res.Outcome)
	}
	if bal, _ := Balance(ctx, pool, u, asset); bal != 0 {
		t.Fatalf("balance=%d want 0 (dust and pending must not credit)", bal)
	}
	// An orphan sub-account resolves to nobody: unmapped, credits nobody.
	orphan := liveProviderDeposit("no-such-"+uuid.NewString(), uuid.NewString(), decimal.NewFromInt(1), 3, cryptoprov.DepositConfirmed)
	if res, _ := s.SettleDeposit(ctx, "quidax", orphan); res.Outcome != OutcomeUnmapped {
		t.Fatalf("orphan outcome=%s want unmapped", res.Outcome)
	}
}
