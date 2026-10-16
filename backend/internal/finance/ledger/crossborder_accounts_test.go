package ledger_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Unit: the parameterised builders validate their inputs (closed-enum invariant).
func TestCrossborderAccountBuilders(t *testing.T) {
	got, err := ledger.PlatformFeeAccount("send")
	if err != nil || got != "revenue:platform_fee:send" {
		t.Fatalf("PlatformFeeAccount(send) = %q, %v", got, err)
	}
	for _, bad := range []string{"", "Send", "a:b", "x y", "send;drop", "a-very-long-service-name-over-the-limit-xxxxxxxxxxxxxxxxx"} {
		if _, err := ledger.PlatformFeeAccount(bad); err == nil {
			t.Errorf("PlatformFeeAccount(%q) should fail", bad)
		}
	}
	cid := uuid.NewString()
	got, err = ledger.FeesUnsweptAccount(cid, "USD")
	if err != nil || string(got) != "fees_unswept:"+cid+":USD" {
		t.Fatalf("FeesUnsweptAccount = %q, %v", got, err)
	}
	for _, c := range [][2]string{{"not-a-uuid", "USD"}, {cid, "usd"}, {cid, "US"}, {cid, ""}, {"", "USD"}} {
		if _, err := ledger.FeesUnsweptAccount(c[0], c[1]); err == nil {
			t.Errorf("FeesUnsweptAccount(%q,%q) should fail", c[0], c[1])
		}
	}
}

// Live DB: every new type is accepted by GetOrCreateStandingAccount; arbitrary
// strings are still rejected by the CHECK.
func TestLiveDB_CrossborderAccountTypes(t *testing.T) {
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

	fee, _ := ledger.PlatformFeeAccount("send")
	unswept, _ := ledger.FeesUnsweptAccount(uuid.NewString(), "USD")
	types := []ledger.AccountType{
		fee, unswept,
		ledger.AccountRevenueFxMarkup, ledger.AccountReceivableVertoMarkup,
		ledger.AccountExpenseProviderFees, ledger.AccountTaxPayableVat,
		ledger.AccountSuspenseUnmatchedInbound,
	}
	for _, at := range types {
		acc, err := svc.GetOrCreateStandingAccount(ctx, at)
		if err != nil || acc.Type != at {
			t.Errorf("%q not accepted: %v", at, err)
		}
	}
	for _, bad := range []ledger.AccountType{"revenue:bogus", "fees_unswept:x", "revenue:platform_fee:BAD SPACE", "anything"} {
		if _, err := svc.GetOrCreateStandingAccount(ctx, bad); err == nil {
			t.Errorf("%q must be rejected by CHECK", bad)
		}
	}
}
