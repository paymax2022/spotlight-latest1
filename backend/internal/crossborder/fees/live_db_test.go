package fees_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/crossborder/fees"
	"spotlight/backend/internal/finance/ledger"
)

// Live DB (TEST_DATABASE_URL, migration 20271043000000 applied): a same-key
// retry of a charge that drained the wallet must converge as a verified no-op,
// NOT return ErrInsufficientFunds — the real PostJournalGated must treat a
// committed replay as success before its balance check.
func TestLiveDB_RetryAfterDrainingChargeConverges(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	svc := ledger.NewService(ledger.NewRepository(pool), nil)
	// Isolate replay-vs-balance behaviour from the tier daily cap.
	svc.SetDebitGuard(func(context.Context, pgx.Tx, string, int64) error { return nil })

	user := uuid.NewString()
	// ledger_accounts.user_id FKs auth.users; entries are immutable so the
	// throwaway user is left in place (unique uuid, local test DB only).
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id) VALUES ($1)`, user); err != nil {
		t.Skipf("cannot create throwaway auth user: %v", err)
	}
	src, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatal(err)
	}
	const fee = int64(2500)
	if err := svc.Credit(ctx, user, "test:fund", "fees-live-fund-"+user, src.ID, fee); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	in := fees.FeeCharge{
		IdempotencyKey: "cb:" + user + ":platform_fee:send",
		TransferID:     user,
		UserID:         user,
		CompanyID:      uuid.NewString(),
		Service:        "send",
		Currency:       "NGN",
		AmountMinor:    fee, // drains the wallet to zero
	}
	c := fees.NewLedgerChargeCollector(svc)
	if _, err := c.Collect(ctx, in); err != nil {
		t.Fatalf("first charge: %v", err)
	}
	if bal, _ := svc.GetBalance(ctx, user); bal != 0 {
		t.Fatalf("wallet should be drained, got %d", bal)
	}
	res, err := c.Collect(ctx, in)
	if err != nil {
		t.Fatalf("retry on drained wallet must converge, got: %v", err)
	}
	if !res.Charged {
		t.Fatalf("retry result %+v", res)
	}
	if bal, _ := svc.GetBalance(ctx, user); bal != 0 {
		t.Fatalf("double charge, balance %d", bal)
	}
	if un, _ := svc.GetAccountBalance(ctx, res.UnsweptAccountID); un != fee {
		t.Fatalf("unswept = %d, want %d", un, fee)
	}
}
