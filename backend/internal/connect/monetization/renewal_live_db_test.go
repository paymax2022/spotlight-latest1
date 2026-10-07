package connectmonetization

// LIVE-DB regression tests for the renewal hardening (audit follow-up):
// ProcessRenewals used to extend a subscription on ANY duplicate sighting —
// including a foreign journal or a bare lock claiming the renewal key — which
// granted paid time against money that never moved. A renewal now extends only
// when the durable ledger carries the exact renewal journal.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other
// live-DB connect suites:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/connect/monetization/ -run TestLiveDB_Renewal -v

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/testsupport"
)

// liveConfirmer is the production connectLedgerConfirmer reimplemented against
// the real ledger (this package cannot import internal/app — cycle): a debit is
// confirmed only when BOTH recorded legs carry the intended journal identity.
type liveConfirmer struct{ ledger *ledger.Service }

func (c *liveConfirmer) leg(ctx context.Context, key, accountID string, typ ledger.EntryType, ref string, amount int64) (bool, error) {
	e, found, err := c.ledger.EntryByKey(ctx, key)
	if err != nil || !found {
		return false, err
	}
	return e.AccountID == accountID && e.Type == typ && e.Reference == ref && e.AmountKobo == amount, nil
}

func (c *liveConfirmer) ConfirmDebit(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64) (bool, error) {
	w, err := c.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return false, err
	}
	rev, err := c.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return false, err
	}
	d, err := c.leg(ctx, idempotencyKey+":debit", w.ID, ledger.EntryDebit, reference, amountKobo)
	if err != nil || !d {
		return false, err
	}
	return c.leg(ctx, idempotencyKey+":credit", rev.ID, ledger.EntryCredit, reference, amountKobo)
}

type liveRevenue struct{ ledger *ledger.Service }

func (r *liveRevenue) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

func renewalPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping connect renewal live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// renewalFixture seeds a KYC-2 subscriber, a subscription plan and a DUE
// entitlement, and returns the service under test plus the seeded ids.
func renewalFixture(t *testing.T, pool *pgxpool.Pool) (svc *Service, ledgerSvc *ledger.Service, userID, entID string, expires time.Time, price int64) {
	t.Helper()
	ctx := context.Background()

	userID = uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		userID, "renewal-test-"+userID+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if _, err := pool.Exec(ctx,
		`UPDATE user_profiles SET kyc_tier = 2 WHERE id = $1`, userID); err != nil {
		t.Fatalf("seed kyc tier: %v", err)
	}

	ledgerSvc = ledger.NewService(ledger.NewRepository(pool), nil)
	svc = NewService(pool, wallet.NewService(ledgerSvc, tiers.NewService(pool)),
		&liveRevenue{ledgerSvc}, &fakeAudit{}, nil)
	svc.SetDebitConfirmer(&liveConfirmer{ledgerSvc})

	// Subscription plan — price 200_000 kobo, 30-day interval.
	planCode := "sub-renewal-" + uuid.NewString()[:8]
	price = 200_000
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_plans (code, kind, name, price_kobo, interval_days, entitlements, active)
		 VALUES ($1,'subscription','Test Sub',$2,30,'{}'::jsonb,true)`, planCode, price); err != nil {
		t.Fatalf("seed plan: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM connect_plans WHERE code = $1`, planCode)
	})

	expires = time.Now().UTC().Add(-time.Hour)
	entID = uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_entitlements (id, user_id, plan_code, kind, features, expires_at, auto_renew, active)
		 VALUES ($1,$2::uuid,$3,'subscription','{}'::jsonb,$4,true,true)`,
		entID, userID, planCode, expires); err != nil {
		t.Fatalf("seed entitlement: %v", err)
	}
	// Re-read the stored expiry so the derived key matches the service's exactly.
	if err := pool.QueryRow(ctx,
		`SELECT expires_at FROM connect_entitlements WHERE id = $1`, entID).Scan(&expires); err != nil {
		t.Fatalf("read back expiry: %v", err)
	}
	// Leave nothing due after the test — the shared dev DB is scanned by every
	// later ProcessRenewals run.
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`UPDATE connect_entitlements SET active = false, auto_renew = false WHERE id = $1`, entID)
	})

	// Fund the wallet (via the ledger — never a balance write).
	rev := mustStandingAccount(t, ledgerSvc, ledger.AccountProviderClearing)
	w, err := ledgerSvc.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		t.Fatalf("user wallet: %v", err)
	}
	fundKey := "test:renew-fund:" + uuid.NewString()
	if err := ledgerSvc.PostJournal(ctx, ledger.JournalEntry{
		Reference: fundKey, IdempotencyKey: fundKey, AmountKobo: 2_000_000,
		DebitAccountID: rev, CreditAccountID: w.ID,
	}); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	return svc, ledgerSvc, userID, entID, expires, price
}

func mustStandingAccount(t *testing.T, ledgerSvc *ledger.Service, at ledger.AccountType) string {
	t.Helper()
	acc, err := ledgerSvc.GetOrCreateStandingAccount(context.Background(), at)
	if err != nil {
		t.Fatalf("standing account %s: %v", at, err)
	}
	return acc.ID
}

func readExpiry(t *testing.T, pool *pgxpool.Pool, entID string) time.Time {
	t.Helper()
	var exp time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT expires_at FROM connect_entitlements WHERE id = $1`, entID).Scan(&exp); err != nil {
		t.Fatalf("read expiry: %v", err)
	}
	return exp
}

// TestLiveDB_Renewal_ForeignKeyClaim_DoesNotExtend: the renewal key is already
// held by a DIFFERENT journal (foreign claim). The duplicate is a rejection,
// not proof of our debit — the subscription must be SKIPPED with its expiry
// untouched, never extended on phantom money.
func TestLiveDB_Renewal_ForeignKeyClaim_DoesNotExtend(t *testing.T) {
	pool := renewalPool(t)
	ctx := context.Background()
	svc, ledgerSvc, userID, entID, expires, _ := renewalFixture(t, pool)

	// Foreign journal pre-claims the renewal base key.
	renewKey := "connect:monetization:renew:" + entID + ":" + expires.UTC().Format(time.RFC3339)
	clearing := mustStandingAccount(t, ledgerSvc, ledger.AccountProviderClearing)
	revenue := mustStandingAccount(t, ledgerSvc, ledger.AccountPaymaxRevenue)
	if err := ledgerSvc.PostJournal(ctx, ledger.JournalEntry{
		Reference: "foreign:" + renewKey, IdempotencyKey: renewKey, AmountKobo: 5_000,
		DebitAccountID: clearing, CreditAccountID: revenue,
	}); err != nil {
		t.Fatalf("pre-claim renewal key: %v", err)
	}

	rep, err := svc.ProcessRenewals(ctx, time.Now().UTC())
	if err != nil {
		t.Fatalf("ProcessRenewals: %v", err)
	}
	if rep.Renewed != 0 {
		t.Fatalf("a foreign key claim must not renew, got renewed=%d", rep.Renewed)
	}
	if got := readExpiry(t, pool, entID); !got.Equal(expires) {
		t.Fatalf("expiry extended on phantom money: %v → %v", expires, got)
	}
	var orders int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM connect_orders WHERE idempotency_key = $1`, renewKey).Scan(&orders); err != nil {
		t.Fatalf("count renewal orders: %v", err)
	}
	if orders != 0 {
		t.Fatalf("foreign claim minted a renewal order")
	}
	// The subscriber's wallet must be untouched by the skipped renewal.
	if bal, _ := ledgerSvc.GetBalance(ctx, userID); bal != 2_000_000 {
		t.Fatalf("wallet moved by an unconfirmed renewal: balance %d, want 2000000", bal)
	}
}

// TestLiveDB_Renewal_TrueReplay_Converges: the renewal journal is already
// durably posted (crash between the debit commit and the entitlement update).
// A rerun must confirm the durable journal, extend the expiry exactly once and
// record the renewal order — never double-charge.
func TestLiveDB_Renewal_TrueReplay_Converges(t *testing.T) {
	pool := renewalPool(t)
	ctx := context.Background()
	svc, ledgerSvc, userID, entID, expires, price := renewalFixture(t, pool)

	// Simulate the crash: post the exact renewal journal directly.
	renewKey := "connect:monetization:renew:" + entID + ":" + expires.UTC().Format(time.RFC3339)
	// The idempotency KEY is namespaced; ledger_ref keeps the stable
	// `connect:renew:` recon surface (the pre-namespace convention).
	renewRef := "connect:renew:subscription:" + planCodeSuffix(t, pool, entID)
	walletSvc := wallet.NewService(ledgerSvc, tiers.NewService(pool))
	rev := mustStandingAccount(t, ledgerSvc, ledger.AccountPaymaxRevenue)
	if err := walletSvc.Debit(ctx, userID, renewRef, renewKey, rev, price); err != nil {
		t.Fatalf("seed committed renewal debit: %v", err)
	}
	balAfterCharge, _ := ledgerSvc.GetBalance(ctx, userID)

	rep, err := svc.ProcessRenewals(ctx, time.Now().UTC())
	if err != nil {
		t.Fatalf("ProcessRenewals: %v", err)
	}
	if rep.Renewed < 1 {
		t.Fatalf("a durably-confirmed renewal must converge, got %+v", rep)
	}
	wantExp := expires.AddDate(0, 0, 30)
	if got := readExpiry(t, pool, entID); !got.Equal(wantExp) {
		t.Fatalf("expiry = %v, want %v", got, wantExp)
	}
	if bal, _ := ledgerSvc.GetBalance(ctx, userID); bal != balAfterCharge {
		t.Fatalf("renewal double-charged: balance %d != %d", bal, balAfterCharge)
	}
	var orders int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM connect_orders WHERE idempotency_key = $1`, renewKey).Scan(&orders); err != nil {
		t.Fatalf("count renewal orders: %v", err)
	}
	if orders != 1 {
		t.Fatalf("renewal order rows = %d, want exactly 1", orders)
	}

	// Re-run: this entitlement is no longer due — its expiry and the wallet must
	// not move again (other tenants' stale due rows in the shared dev DB are
	// out of scope for this assertion).
	if _, err := svc.ProcessRenewals(ctx, time.Now().UTC()); err != nil {
		t.Fatalf("ProcessRenewals re-run: %v", err)
	}
	if got := readExpiry(t, pool, entID); !got.Equal(wantExp) {
		t.Fatalf("second run moved the expiry again: %v → %v (double-extend)", wantExp, got)
	}
	if bal, _ := ledgerSvc.GetBalance(ctx, userID); bal != balAfterCharge {
		t.Fatalf("second run debited again: balance %d != %d", bal, balAfterCharge)
	}
}

// planCodeSuffix reads the entitlement's plan code back so the test builds the
// same renewal reference the service derives.
func planCodeSuffix(t *testing.T, pool *pgxpool.Pool, entID string) string {
	t.Helper()
	var code string
	if err := pool.QueryRow(context.Background(),
		`SELECT plan_code FROM connect_entitlements WHERE id = $1`, entID).Scan(&code); err != nil {
		t.Fatalf("read plan_code: %v", err)
	}
	return code
}
