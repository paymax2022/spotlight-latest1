// The load-bearing invariant of per-user module grants: a grant opens a MODULE, it
// never opens the WALLET.
//
// This test lives outside both packages on purpose. It is the only place that imports
// modules AND finance/tiers together — the production code must not, and that
// separation is what keeps an admin grant from becoming an AML decision. If someone
// later wires grants into spending, this test fails.
package modules_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/modules"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_GrantOpensModuleButNotTheWallet(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB grant/money boundary test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	uid := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, uid, uid+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	// Tier 0 — registered, no KYC. This is ~94% of real profiles.
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id,email,kyc_tier) VALUES ($1,$2,0)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier=0`, uid, uid+"@seed.test"); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM user_module_grants WHERE user_id=$1`, uid)
	})

	modSvc := modules.NewService(pool, modules.Environment("production"), func(string) bool { return true })
	tierSvc := tiers.NewService(pool)
	_ = goredis.Client{}

	// Baseline: the wallet is closed to a Tier 0 user.
	errBefore := tierSvc.EnforceWalletDebitLimit(ctx, uid, 100_00)
	if errBefore == nil {
		t.Fatal("precondition failed: a Tier 0 user should not pass the wallet debit gate")
	}

	// Grant EVERY module this user could possibly need.
	rows, err := pool.Query(ctx, `SELECT key FROM platform_modules`)
	if err != nil {
		t.Fatalf("list modules: %v", err)
	}
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, k)
	}
	rows.Close()
	for _, k := range keys {
		if err := modSvc.Grant(ctx, uid, k, "", "boundary test", nil); err != nil {
			t.Fatalf("grant %s: %v", k, err)
		}
	}

	// Module access opened…
	acc, err := modSvc.AccessFor(ctx, uid)
	if err != nil {
		t.Fatalf("access: %v", err)
	}
	if len(acc.Modules)+len(acc.ComingSoon) == 0 {
		t.Error("after granting every module the user should have access to some")
	}
	if acc.KycTier != 0 {
		t.Errorf("kycTier = %d after grants, want 0 — a grant must never change the tier", acc.KycTier)
	}

	// …and the wallet is STILL closed. This is the whole point.
	errAfter := tierSvc.EnforceWalletDebitLimit(ctx, uid, 100_00)
	if errAfter == nil {
		t.Fatal("SECURITY: granting modules opened the wallet for an unverified user — " +
			"grants must control module access only, never money")
	}
	if !errors.Is(errAfter, tiers.ErrWalletDisabled) && errAfter.Error() != errBefore.Error() {
		t.Errorf("wallet gate changed shape after grants: before=%v after=%v", errBefore, errAfter)
	}
}
