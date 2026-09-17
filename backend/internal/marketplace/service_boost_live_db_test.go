package marketplace

// ---------------------------------------------------------------------------
// LIVE-DB UAT for the Marketplace Boost money path (docs/qa/modules/marketplace.md
// §4 P0 cases MKT-INT-001, MKT-INV-001/002/003/004, MKT-SEC-001) plus a new case
// proving the tier-limit gate added to close the §6 "Tier/KYC gate" FINDING
// (PurchaseBoost previously called s.ledger.Debit directly with no tier-limit/KYC
// gate at all).
//
// service_boost_test.go already covers the ledger EFFECT (postBoostCharge /
// postBoostRefund) against an in-memory fake boostLedger — real, but not a
// live-DB money-path UAT case: it never exercises the real Postgres ledger
// tables, the real tiers.Service, or genuine concurrent goroutines. This file
// is that live-DB layer, following the pattern established by
// internal/estate/service_dues_live_db_test.go (added this session): TEST_
// DATABASE_URL-gated, pgxpool via t.Cleanup, real ledger wired via
// ledger.NewService(ledger.NewRepository(pool), nil), wallets funded through
// the ledger (never a direct balance UPDATE — wallet balances are a ledger
// projection, never mutated directly, per CLAUDE.md).
//
// Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/... -run TestLiveDB -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

// ── pool / service wiring ─────────────────────────────────────────────────

func boostTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB marketplace boost tests")
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

// newBoostTestService wires a real marketplace Service against the live pool:
// real ledger (no redis — DB-unique idempotency backstop only, same choice
// service_dues_live_db_test.go makes) and the real tiers.Service, exactly as
// app-wiring does in internal/app/marketplace_routes.go's RegisterMarketplace.
func newBoostTestService(pool *pgxpool.Pool) (*Service, *ledger.Service) {
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, nil).WithTiers(tiers.NewService(pool))
	return svc, led
}

// ── fixture helpers ─────────────────────────────────────────────────────────

// seedBoostSeller inserts a throwaway auth.users + user_profiles row at the
// given KYC tier and registers cleanup. Tier3 ("full KYC") carries an
// unlimited daily debit limit (tiers/model.go tierConfigs), so every P0 case
// EXCEPT the tier-gate case itself seeds Tier3 — mirrors
// internal/estate/service_dues_live_db_test.go's seedDuesUser choice of Tier3
// so the tier gate never accidentally fires as a false positive in the other
// six cases.
func seedBoostSeller(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tier int) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,$3)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`, id, id+"@seed.test", tier); err != nil {
		t.Fatalf("seed user_profiles kyc tier: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// seedBoostCategory + seedActiveListing give PurchaseBoost a real
// (category_id-FK-satisfying) listing owned by sellerID, already `active` (the
// FSM precondition on the boost purchase's listing — CreateOffer's own
// ListingActive guard mirrors this elsewhere in the package).
func seedBoostCategory(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO mkt_categories (id, market_id, slug, name) VALUES ($1,'NG',$2,'Boost Test Category')`,
		id, "boost-test-"+id); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_categories WHERE id=$1`, id) })
	return id
}

func seedActiveListing(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sellerID, categoryID string) string {
	t.Helper()
	id := uuid.New().String()
	const q = `
		INSERT INTO mkt_listings
			(id, market_id, seller_id, category_id, title, description, price_kobo, currency,
			 condition, status, escrow_eligible, state)
		VALUES ($1,'NG',$2,$3,'Boost Test Listing Title','A perfectly ordinary listing description with eight whole words',
		        1000000,'NGN','used','active',true,'Lagos')`
	if _, err := pool.Exec(ctx, q, id, sellerID, categoryID); err != nil {
		t.Fatalf("seed listing: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_listings WHERE id=$1`, id) })
	return id
}

// fundWallet credits sellerID's wallet from the platform revenue standing
// account — the only sanctioned way to give a test wallet a balance (never a
// direct UPDATE of a balance column: wallet balances are ledger projections).
func fundBoostWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing revenue acct: %v", err)
	}
	if err := led.Credit(ctx, userID, "seed-fund", "boost-fund-"+uuid.New().String(), revAcc.ID, amountKobo); err != nil {
		t.Fatalf("fund wallet for %s: %v", userID, err)
	}
}

func boostWalletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id=$1`, userID).Scan(&bal); err != nil {
		t.Fatalf("wallet balance for %s: %v", userID, err)
	}
	return bal
}

func boostStandingBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, accountType string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id IS NULL AND a.type=$1`, accountType).Scan(&bal); err != nil {
		t.Fatalf("standing balance for %s: %v", accountType, err)
	}
	return bal
}

func boostRowCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, listingID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mkt_boosts WHERE listing_id=$1`, listingID).Scan(&n); err != nil {
		t.Fatalf("boost row count: %v", err)
	}
	return n
}

func ledgerEntryCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, reference string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference=$1`, reference).Scan(&n); err != nil {
		t.Fatalf("ledger entry count for ref %s: %v", reference, err)
	}
	return n
}

// startTierPriceKobo is the "start" boost package's seeded price (50000 kobo,
// 7 days) per 20270168000000_marketplace_boost_pricing_config.sql — well
// within Tier1's ₦50k/day limit (5,000,000 kobo), so it never accidentally
// trips the tier gate in the six cases that are not the tier-gate case itself.
const startTierPriceKobo int64 = 50000

// ── MKT-INT-001 ──────────────────────────────────────────────────────────────

// TestLiveDB_PurchaseBoost_DebitsWalletActivatesBoost_BalancedLedger covers
// MKT-INT-001: boost purchase debits the seller wallet, activates the boost,
// and posts a balanced ledger debit into AccountCommission.
func TestLiveDB_PurchaseBoost_DebitsWalletActivatesBoost_BalancedLedger(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	sellerBalBefore := boostWalletBalance(t, ctx, pool, seller)
	commissionBefore := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))

	boost, err := svc.PurchaseBoost(ctx, seller, "int001-"+listingID, CreateBoostInput{ListingID: listingID, Tier: "start"})
	if err != nil {
		t.Fatalf("PurchaseBoost: %v", err)
	}
	if boost.Status != BoostActive {
		t.Errorf("boost.Status = %q, want %q", boost.Status, BoostActive)
	}
	if boost.PriceKobo != startTierPriceKobo {
		t.Errorf("boost.PriceKobo = %d, want %d", boost.PriceKobo, startTierPriceKobo)
	}
	wantRef := boostChargeKey(seller, listingID, "start")
	if boost.LedgerChargeRef != wantRef {
		t.Errorf("boost.LedgerChargeRef = %q, want %q", boost.LedgerChargeRef, wantRef)
	}

	sellerBalAfter := boostWalletBalance(t, ctx, pool, seller)
	commissionAfter := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	if sellerBalBefore-sellerBalAfter != startTierPriceKobo {
		t.Errorf("seller debited %d, want %d", sellerBalBefore-sellerBalAfter, startTierPriceKobo)
	}
	if commissionAfter-commissionBefore != startTierPriceKobo {
		t.Errorf("commission credited %d, want %d (balanced double-entry)", commissionAfter-commissionBefore, startTierPriceKobo)
	}
	if n := boostRowCount(t, ctx, pool, listingID); n != 1 {
		t.Errorf("mkt_boosts rows for listing = %d, want 1", n)
	}
}

// ── MKT-INV-001 ──────────────────────────────────────────────────────────────

// TestLiveDB_PurchaseBoost_ReplaySameIdempotencyKey_SingleCharge covers
// MKT-INV-001: replaying the same Idempotency-Key returns the cached 201 body
// and the wallet is debited exactly once.
func TestLiveDB_PurchaseBoost_ReplaySameIdempotencyKey_SingleCharge(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	key := "inv001-" + listingID
	commissionBefore := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))

	first, err := svc.PurchaseBoost(ctx, seller, key, CreateBoostInput{ListingID: listingID, Tier: "start"})
	if err != nil {
		t.Fatalf("first PurchaseBoost: %v", err)
	}

	// Replay: without a redis client the fast-path cache is skipped (checkIdempotent
	// no-ops), but the deterministic ledger charge key still collides on the DB-side
	// ledger uniqueness (ledger.ErrDuplicate is tolerated in postBoostCharge), which
	// is the durable backstop this test asserts — a SECOND mkt_boosts row is the one
	// thing that must never happen, and it would if postBoostCharge's ErrDuplicate
	// tolerance regressed.
	second, err := svc.PurchaseBoost(ctx, seller, key, CreateBoostInput{ListingID: listingID, Tier: "start"})
	if err != nil {
		t.Fatalf("replay PurchaseBoost: %v", err)
	}
	if second.LedgerChargeRef != first.LedgerChargeRef {
		t.Errorf("replay LedgerChargeRef = %q, want %q (same deterministic charge key)", second.LedgerChargeRef, first.LedgerChargeRef)
	}

	commissionAfter := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	if commissionAfter-commissionBefore != startTierPriceKobo {
		t.Errorf("commission credited %d across both calls, want exactly %d once (no double charge)", commissionAfter-commissionBefore, startTierPriceKobo)
	}
	if n := ledgerEntryCount(t, ctx, pool, first.LedgerChargeRef); n != 2 { // one DEBIT leg + one CREDIT leg = balanced pair, posted once
		t.Errorf("ledger_entries for charge ref = %d, want exactly 2 (one balanced posting, not two)", n)
	}
}

// ── MKT-INV-002 ──────────────────────────────────────────────────────────────

// TestLiveDB_PurchaseBoost_MissingIdempotencyKey covers MKT-INV-002: a missing
// Idempotency-Key is rejected before any ledger posting.
func TestLiveDB_PurchaseBoost_MissingIdempotencyKey(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	commissionBefore := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))

	_, err := svc.PurchaseBoost(ctx, seller, "", CreateBoostInput{ListingID: listingID, Tier: "start"})
	if !errors.Is(err, error(ErrIdemMissing)) {
		var ce *CodedError
		if !(errors.As(err, &ce) && ce.Code == CodeIdempotencyMissing) {
			t.Fatalf("err = %v, want IDEMPOTENCY_KEY_REQUIRED", err)
		}
	}
	if n := boostRowCount(t, ctx, pool, listingID); n != 0 {
		t.Errorf("mkt_boosts rows = %d, want 0", n)
	}
	commissionAfter := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	if commissionAfter != commissionBefore {
		t.Errorf("commission balance moved by %d, want 0 (no ledger posting)", commissionAfter-commissionBefore)
	}
}

// ── MKT-INV-003 ──────────────────────────────────────────────────────────────

// TestLiveDB_RejectBoost_AutoRefundBalancedReversal covers MKT-INV-003: admin
// reject reverses the exact kobo via a balanced reversal, stamps refund_ref,
// and writes an audit row.
func TestLiveDB_RejectBoost_AutoRefundBalancedReversal(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	admin := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	boost, err := svc.PurchaseBoost(ctx, seller, "inv003-"+listingID, CreateBoostInput{ListingID: listingID, Tier: "start"})
	if err != nil {
		t.Fatalf("PurchaseBoost: %v", err)
	}

	sellerBalBefore := boostWalletBalance(t, ctx, pool, seller)
	commissionBefore := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))

	rejected, err := svc.RejectBoost(ctx, admin, boost.ID, "policy_violation")
	if err != nil {
		t.Fatalf("RejectBoost: %v", err)
	}
	if rejected.Status != BoostAutoRefunded {
		t.Errorf("rejected.Status = %q, want %q", rejected.Status, BoostAutoRefunded)
	}
	if rejected.RefundRef == nil || *rejected.RefundRef != boostRefundKey(boost.ID) {
		t.Errorf("RefundRef = %v, want %q", rejected.RefundRef, boostRefundKey(boost.ID))
	}
	if rejected.RefundedKobo == nil || *rejected.RefundedKobo != startTierPriceKobo {
		t.Errorf("RefundedKobo = %v, want %d", rejected.RefundedKobo, startTierPriceKobo)
	}

	sellerBalAfter := boostWalletBalance(t, ctx, pool, seller)
	commissionAfter := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	if sellerBalAfter-sellerBalBefore != startTierPriceKobo {
		t.Errorf("seller credited back %d, want %d", sellerBalAfter-sellerBalBefore, startTierPriceKobo)
	}
	if commissionBefore-commissionAfter != startTierPriceKobo {
		t.Errorf("commission debited back %d, want %d (balanced reversal)", commissionBefore-commissionAfter, startTierPriceKobo)
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mkt_admin_audit_log WHERE target_id=$1 AND action='mkt.boost.reject'`, boost.ID).Scan(&auditCount); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("mkt.boost.reject audit rows = %d, want 1", auditCount)
	}
}

// ── Coordinator-flagged RejectBoost fixes (UAT follow-up) ───────────────────
//
// Three sibling agents independently found RejectBoost's OLD two-UPDATE
// sequence (status -> rejected_with_reason, committed; THEN post the refund;
// THEN status -> auto_refunded) was not atomic/resumable. The three tests
// below reproduce each finding against the FIXED RejectBoost and prove it
// closed:
//
//  1. seller with no ledger_accounts row -> refund fails -> boost must stay
//     at its ORIGINAL status (never stranded at rejected_with_reason).
//  2. a boost already stranded at rejected_with_reason with no refund posted
//     (simulating data left over from the OLD bug) must be resumable, not
//     permanently stuck behind an illegal-transition 409.
//  3. MKT-FSM-015: re-rejecting an already-auto_refunded boost is an
//     idempotent no-op, not a 409.

// TestLiveDB_RejectBoost_SellerMissingLedgerAccount_FailsAtomicallyWithoutStranding
// reproduces admin-console agent #1: a seller with no ledger_accounts row (and,
// here, no auth.users row at all — mkt_listings/mkt_boosts.seller_id carries NO
// FK, per 20260905000000_marketplace_v1.sql's own comment, so this is a legal
// state to seed directly). postBoostRefund's GetOrCreateUserWallet INSERT must
// fail with the FK violation described live, and — the actual regression — the
// boost row must come out of that failure UNCHANGED at its original status,
// never stranded at rejected_with_reason with refund_ref still NULL.
func TestLiveDB_RejectBoost_SellerMissingLedgerAccount_FailsAtomicallyWithoutStranding(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, _ := newBoostTestService(pool)

	fakeSeller := uuid.New().String() // deliberately NOT in auth.users
	admin := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, fakeSeller, catID)

	// Seed the boost row directly, bypassing PurchaseBoost — going through
	// PurchaseBoost would itself auto-create ledger_accounts for the seller via
	// ledger.Debit's GetOrCreateUserWallet, which is exactly the condition this
	// test must NOT have: a boost that reached 'active' without its seller ever
	// getting a wallet account.
	boostID := uuid.New().String()
	const insBoost = `
		INSERT INTO mkt_boosts (id, listing_id, seller_id, tier, duration_days, price_kobo, weight, status, ledger_charge_ref, starts_at, ends_at)
		VALUES ($1,$2,$3,'start',7,$4,1.0,'active',$5,now(),now()+interval '7 days')`
	if _, err := pool.Exec(ctx, insBoost, boostID, listingID, fakeSeller, startTierPriceKobo, "test:charge:"+boostID); err != nil {
		t.Fatalf("seed boost: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_boosts WHERE id=$1`, boostID) })

	_, err := svc.RejectBoost(ctx, admin, boostID, "policy_violation")
	if err == nil {
		t.Fatal("expected RejectBoost to fail — the seller has no ledger_accounts row and no auth.users row to create one against")
	}
	t.Logf("RejectBoost failed as expected (seller has no wallet account): %v", err)

	// THE core assertion: unchanged at the ORIGINAL status, no partial refund
	// stamp. Before the fix this would read status='rejected_with_reason',
	// refund_ref=NULL — the stranded state agent #1 reported live.
	var status string
	var refundRef *string
	if err := pool.QueryRow(ctx, `SELECT status, refund_ref FROM mkt_boosts WHERE id=$1`, boostID).Scan(&status, &refundRef); err != nil {
		t.Fatalf("read boost: %v", err)
	}
	if status != string(BoostActive) {
		t.Errorf("boost status = %q, want unchanged %q — a failed refund must not strand the row at an intermediate status", status, BoostActive)
	}
	if refundRef != nil {
		t.Errorf("refund_ref = %v, want nil", refundRef)
	}

	// RESUMABLE: once the seller has a real identity (ops backfill in
	// production; here, just seeding auth.users), a retry must succeed cleanly
	// — guardBoostTransition still accepts 'active' as the FROM status because
	// the failed attempt changed nothing.
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, fakeSeller, fakeSeller+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users for retry: %v", err)
	}
	testsupport.CleanupUser(t, pool, fakeSeller)

	rejected, err := svc.RejectBoost(ctx, admin, boostID, "policy_violation")
	if err != nil {
		t.Fatalf("retry RejectBoost after seller identity exists: %v", err)
	}
	if rejected.Status != BoostAutoRefunded {
		t.Errorf("retry rejected.Status = %q, want %q", rejected.Status, BoostAutoRefunded)
	}
	if rejected.RefundRef == nil {
		t.Error("retry RefundRef is nil, want stamped")
	}
}

// TestLiveDB_RejectBoost_ResumesFromStrandedRejectedWithReasonRow reproduces
// admin-console agent #2: a boost already sitting at status=rejected_with_reason
// with refund_ref/refunded_kobo both NULL (exactly the state the OLD code's
// first UPDATE — committed independently of the refund — could leave behind).
// Calling RejectBoost again must complete the missing refund leg, not return
// 409 "rejected_with_reason -> rejected_with_reason".
func TestLiveDB_RejectBoost_ResumesFromStrandedRejectedWithReasonRow(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	admin := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	boostID := uuid.New().String()
	const insBoost = `
		INSERT INTO mkt_boosts (id, listing_id, seller_id, tier, duration_days, price_kobo, weight, status, rejection_reason_code, ledger_charge_ref, starts_at, ends_at)
		VALUES ($1,$2,$3,'start',7,$4,1.0,'rejected_with_reason','policy_violation',$5,now(),now()+interval '7 days')`
	if _, err := pool.Exec(ctx, insBoost, boostID, listingID, seller, startTierPriceKobo, "test:charge:"+boostID); err != nil {
		t.Fatalf("seed stranded boost: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_boosts WHERE id=$1`, boostID) })

	sellerBalBefore := boostWalletBalance(t, ctx, pool, seller)

	rejected, err := svc.RejectBoost(ctx, admin, boostID, "policy_violation")
	if err != nil {
		t.Fatalf("RejectBoost on a stranded rejected_with_reason row: %v — must be resumable, not stuck behind an illegal-transition error", err)
	}
	if rejected.Status != BoostAutoRefunded {
		t.Errorf("Status = %q, want %q", rejected.Status, BoostAutoRefunded)
	}
	if rejected.RefundRef == nil {
		t.Error("RefundRef is nil, want stamped")
	}
	if rejected.RefundedKobo == nil || *rejected.RefundedKobo != startTierPriceKobo {
		t.Errorf("RefundedKobo = %v, want %d", rejected.RefundedKobo, startTierPriceKobo)
	}

	sellerBalAfter := boostWalletBalance(t, ctx, pool, seller)
	if sellerBalAfter-sellerBalBefore != startTierPriceKobo {
		t.Errorf("seller credited %d, want %d — the missing refund leg must complete on resume", sellerBalAfter-sellerBalBefore, startTierPriceKobo)
	}
}

// ── MKT-FSM-015 ──────────────────────────────────────────────────────────────

// TestLiveDB_RejectBoost_AlreadyAutoRefunded_IsIdempotentNoOp covers the AUTHZ
// agent's lower-severity finding: re-rejecting an already-auto_refunded boost
// must return the existing 200 receipt (idempotent no-op) per
// docs/qa/modules/marketplace.md MKT-FSM-015, not 409 INVALID_BOOST_TRANSITION
// — and, more importantly for money safety, must NOT post a second refund.
func TestLiveDB_RejectBoost_AlreadyAutoRefunded_IsIdempotentNoOp(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	admin := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	boost, err := svc.PurchaseBoost(ctx, seller, "fsm015-"+listingID, CreateBoostInput{ListingID: listingID, Tier: "start"})
	if err != nil {
		t.Fatalf("PurchaseBoost: %v", err)
	}
	first, err := svc.RejectBoost(ctx, admin, boost.ID, "policy_violation")
	if err != nil {
		t.Fatalf("first RejectBoost: %v", err)
	}

	commissionBefore := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	sellerBalBefore := boostWalletBalance(t, ctx, pool, seller)

	second, err := svc.RejectBoost(ctx, admin, boost.ID, "policy_violation")
	if err != nil {
		t.Fatalf("re-rejecting an already auto_refunded boost must be an idempotent no-op (MKT-FSM-015), got error: %v", err)
	}
	if second.Status != BoostAutoRefunded {
		t.Errorf("second.Status = %q, want %q", second.Status, BoostAutoRefunded)
	}
	if second.ID != first.ID {
		t.Errorf("second.ID = %q, want %q (same canonical row)", second.ID, first.ID)
	}
	if second.RefundRef == nil || first.RefundRef == nil || *second.RefundRef != *first.RefundRef {
		t.Errorf("RefundRef changed across calls: first=%v second=%v", first.RefundRef, second.RefundRef)
	}

	commissionAfter := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	sellerBalAfter := boostWalletBalance(t, ctx, pool, seller)
	if commissionAfter != commissionBefore {
		t.Errorf("commission balance moved by %d on the no-op re-reject, want 0 (no second refund)", commissionAfter-commissionBefore)
	}
	if sellerBalAfter != sellerBalBefore {
		t.Errorf("seller wallet moved by %d on the no-op re-reject, want 0", sellerBalAfter-sellerBalBefore)
	}
}

// ── MKT-INV-004 ──────────────────────────────────────────────────────────────

// TestLiveDB_PurchaseBoost_InsufficientBalance_FailsClosed covers MKT-INV-004:
// insufficient wallet balance fails closed — no boost row, no partial ledger entry.
func TestLiveDB_PurchaseBoost_InsufficientBalance_FailsClosed(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	// Fund LESS than the "enterprise" tier price (5,000,000 kobo) so the debit fails
	// on ledger balance, not on the Tier3 daily limit (which is unlimited).
	fundBoostWallet(t, ctx, led, seller, 4_000_000)

	commissionBefore := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))

	_, err := svc.PurchaseBoost(ctx, seller, "inv004-"+listingID, CreateBoostInput{ListingID: listingID, Tier: "enterprise"})
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Code != CodeInsufficientWallet {
		t.Fatalf("err = %v, want INSUFFICIENT_WALLET_BALANCE", err)
	}
	if ce.Status != 402 {
		t.Errorf("status = %d, want 402", ce.Status)
	}
	if n := boostRowCount(t, ctx, pool, listingID); n != 0 {
		t.Errorf("mkt_boosts rows = %d, want 0", n)
	}
	commissionAfter := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	if commissionAfter != commissionBefore {
		t.Errorf("commission balance moved by %d, want 0 (no partial ledger entry)", commissionAfter-commissionBefore)
	}
}

// ── MKT-SEC-001 ──────────────────────────────────────────────────────────────

// TestLiveDB_PurchaseBoost_ConcurrentDuplicate_SingleCharge covers MKT-SEC-001:
// two GENUINELY concurrent PurchaseBoost calls (real goroutines + sync.WaitGroup)
// for the same seller+listing+tier, with DISTINCT Idempotency-Keys, collide on
// the deterministic charge key and the wallet is debited exactly once.
func TestLiveDB_PurchaseBoost_ConcurrentDuplicate_SingleCharge(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	commissionBefore := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))

	const n = 2
	var wg sync.WaitGroup
	results := make([]*Boost, n)
	errs := make([]error, n)
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = svc.PurchaseBoost(ctx, seller, uuid.New().String(), CreateBoostInput{ListingID: listingID, Tier: "start"})
		}(i)
	}
	wg.Wait()

	successCount := 0
	for i := 0; i < n; i++ {
		if errs[i] == nil {
			successCount++
		} else {
			t.Logf("goroutine %d: %v (tolerated — the deterministic charge key collision may surface as an error on the losing caller)", i, errs[i])
		}
	}
	if successCount == 0 {
		t.Fatalf("both concurrent calls failed: %v, %v", errs[0], errs[1])
	}

	// The money-safety invariant: exactly ONE charge posted, regardless of how many
	// callers "succeeded" at the application layer.
	commissionAfter := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	if commissionAfter-commissionBefore != startTierPriceKobo {
		t.Fatalf("commission credited %d across both concurrent calls, want exactly %d once", commissionAfter-commissionBefore, startTierPriceKobo)
	}
	if n := boostRowCount(t, ctx, pool, listingID); n < 1 {
		t.Fatalf("mkt_boosts rows = %d, want at least 1 (the winner's row)", n)
	}
}

// ── NEW: tier-limit gate (Task 1 of this UAT pass) ──────────────────────────

// TestLiveDB_PurchaseBoost_TierGateRefusesTier0Seller proves the fail-closed
// tier-limit gate added to close §6's "Tier/KYC gate (FINDING)" actually
// fires: a Tier0 seller (DailyDebitLimitKobo=0 — tiers/model.go) is refused
// with a clear TIER_LIMIT_EXCEEDED error, BEFORE any ledger posting, even
// though the wallet itself holds more than enough naira to cover the boost.
func TestLiveDB_PurchaseBoost_TierGateRefusesTier0Seller(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 0) // Tier0 — unverified, wallet disabled
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	// Fund WAY more than the boost price — proves this is a TIER refusal, not an
	// insufficient-balance refusal (that's MKT-INV-004, a different code path).
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*1000)

	sellerBalBefore := boostWalletBalance(t, ctx, pool, seller)
	commissionBefore := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))

	_, err := svc.PurchaseBoost(ctx, seller, "tiergate-"+listingID, CreateBoostInput{ListingID: listingID, Tier: "start"})
	if err == nil {
		t.Fatal("expected the tier gate to refuse a Tier0 seller's boost purchase")
	}
	var ce *CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("err = %v (%T), want a *CodedError", err, err)
	}
	if ce.Code != CodeTierLimitExceeded {
		t.Errorf("error code = %q, want %q — must be a CLEAR tier-limit error, not a generic failure", ce.Code, CodeTierLimitExceeded)
	}
	if ce.Status != 403 {
		t.Errorf("status = %d, want 403", ce.Status)
	}

	// No ledger posting at all — the gate runs BEFORE postBoostCharge.
	sellerBalAfter := boostWalletBalance(t, ctx, pool, seller)
	commissionAfter := boostStandingBalance(t, ctx, pool, string(ledger.AccountCommission))
	if sellerBalAfter != sellerBalBefore {
		t.Errorf("seller wallet moved by %d, want 0 (tier gate must run before any ledger posting)", sellerBalAfter-sellerBalBefore)
	}
	if commissionAfter != commissionBefore {
		t.Errorf("commission balance moved by %d, want 0", commissionAfter-commissionBefore)
	}
	if n := boostRowCount(t, ctx, pool, listingID); n != 0 {
		t.Errorf("mkt_boosts rows = %d, want 0 (refused before the boost row is ever created)", n)
	}
}

// TestLiveDB_PurchaseBoost_NilTierEnforcer_FailsClosed proves the OTHER half of
// the fail-closed contract: a Service built WITHOUT a TierEnforcer (WithTiers
// never called) refuses every boost purchase rather than silently skipping the
// check — the deliberately stricter-than-estate behaviour the task asked for
// (estate's PayDues treats a nil tiers as "no gate configured, allow"; this
// money path treats nil as "misconfigured, refuse").
func TestLiveDB_PurchaseBoost_NilTierEnforcer_FailsClosed(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, nil) // deliberately NOT .WithTiers(...)

	seller := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	_, err := svc.PurchaseBoost(ctx, seller, "niltier-"+listingID, CreateBoostInput{ListingID: listingID, Tier: "start"})
	if !errors.Is(err, error(ErrTierGateUnwired)) {
		var ce *CodedError
		if !(errors.As(err, &ce) && ce.Code == CodeTierGateUnwired) {
			t.Fatalf("err = %v, want ErrTierGateUnwired (TIER_GATE_UNWIRED)", err)
		}
	}
	if n := boostRowCount(t, ctx, pool, listingID); n != 0 {
		t.Errorf("mkt_boosts rows = %d, want 0", n)
	}
}

// ── CancelBoost: same atomicity/resumability fix as RejectBoost ────────────
//
// The coordinator independently spotted that CancelBoost (the seller-initiated
// counterpart to RejectBoost) had the IDENTICAL non-atomic two-UPDATE pattern:
// status -> cancelled_by_seller committed standalone, THEN the refund posted,
// THEN a second UPDATE to auto_refunded. The two tests below mirror the
// RejectBoost regression tests exactly, on the cancel path.

// TestLiveDB_CancelBoost_SellerMissingLedgerAccount_FailsAtomicallyWithoutStranding
// mirrors TestLiveDB_RejectBoost_SellerMissingLedgerAccount_FailsAtomicallyWithoutStranding:
// a seller with no ledger_accounts/auth.users row at all, so postBoostRefund's
// GetOrCreateUserWallet INSERT fails with the same FK violation. The boost must
// come out of that failure UNCHANGED at its original 'active' status, then
// succeed on retry once the seller has a real identity.
func TestLiveDB_CancelBoost_SellerMissingLedgerAccount_FailsAtomicallyWithoutStranding(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, _ := newBoostTestService(pool)

	fakeSeller := uuid.New().String() // deliberately NOT in auth.users
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, fakeSeller, catID)

	// Seed the boost directly (bypassing PurchaseBoost, which would auto-create
	// ledger_accounts for the seller) at 'active', mid-way through its window so
	// proratedBoostRefund computes a NONZERO refund — a zero refund would skip
	// postBoostRefund entirely and never exercise the FK failure.
	boostID := uuid.New().String()
	const insBoost = `
		INSERT INTO mkt_boosts (id, listing_id, seller_id, tier, duration_days, price_kobo, weight, status, ledger_charge_ref, starts_at, ends_at)
		VALUES ($1,$2,$3,'start',7,$4,1.0,'active',$5, now() - interval '1 day', now() + interval '6 days')`
	if _, err := pool.Exec(ctx, insBoost, boostID, listingID, fakeSeller, startTierPriceKobo, "test:charge:"+boostID); err != nil {
		t.Fatalf("seed boost: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_boosts WHERE id=$1`, boostID) })

	_, err := svc.CancelBoost(ctx, fakeSeller, boostID)
	if err == nil {
		t.Fatal("expected CancelBoost to fail — the seller has no ledger_accounts row and no auth.users row to create one against")
	}
	t.Logf("CancelBoost failed as expected (seller has no wallet account): %v", err)

	var status string
	var refundRef *string
	if err := pool.QueryRow(ctx, `SELECT status, refund_ref FROM mkt_boosts WHERE id=$1`, boostID).Scan(&status, &refundRef); err != nil {
		t.Fatalf("read boost: %v", err)
	}
	if status != string(BoostActive) {
		t.Errorf("boost status = %q, want unchanged %q — a failed refund must not strand the row at an intermediate status", status, BoostActive)
	}
	if refundRef != nil {
		t.Errorf("refund_ref = %v, want nil", refundRef)
	}

	// RESUMABLE: once the seller has a real identity, a retry must succeed.
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, fakeSeller, fakeSeller+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users for retry: %v", err)
	}
	testsupport.CleanupUser(t, pool, fakeSeller)

	cancelled, err := svc.CancelBoost(ctx, fakeSeller, boostID)
	if err != nil {
		t.Fatalf("retry CancelBoost after seller identity exists: %v", err)
	}
	if cancelled.Status != BoostAutoRefunded {
		t.Errorf("retry cancelled.Status = %q, want %q", cancelled.Status, BoostAutoRefunded)
	}
	if cancelled.RefundRef == nil {
		t.Error("retry RefundRef is nil, want stamped")
	}
	if cancelled.RefundedKobo == nil || *cancelled.RefundedKobo <= 0 {
		t.Errorf("retry RefundedKobo = %v, want a positive prorated amount", cancelled.RefundedKobo)
	}
}

// TestLiveDB_CancelBoost_ResumesFromStrandedCancelledBySellerRow mirrors
// TestLiveDB_RejectBoost_ResumesFromStrandedRejectedWithReasonRow: a boost
// already sitting at status=cancelled_by_seller with refund_ref/refunded_kobo
// both NULL (exactly what the OLD code's standalone first UPDATE could leave
// behind). Calling CancelBoost again must complete the missing refund leg, not
// return 409 "cancelled_by_seller -> cancelled_by_seller".
func TestLiveDB_CancelBoost_ResumesFromStrandedCancelledBySellerRow(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, led := newBoostTestService(pool)

	seller := seedBoostSeller(t, ctx, pool, 3)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, seller, catID)
	fundBoostWallet(t, ctx, led, seller, startTierPriceKobo*10)

	boostID := uuid.New().String()
	const insBoost = `
		INSERT INTO mkt_boosts (id, listing_id, seller_id, tier, duration_days, price_kobo, weight, status, rejection_reason_code, ledger_charge_ref, starts_at, ends_at)
		VALUES ($1,$2,$3,'start',7,$4,1.0,'cancelled_by_seller','seller_cancelled',$5, now() - interval '1 day', now() + interval '6 days')`
	if _, err := pool.Exec(ctx, insBoost, boostID, listingID, seller, startTierPriceKobo, "test:charge:"+boostID); err != nil {
		t.Fatalf("seed stranded boost: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_boosts WHERE id=$1`, boostID) })

	sellerBalBefore := boostWalletBalance(t, ctx, pool, seller)

	cancelled, err := svc.CancelBoost(ctx, seller, boostID)
	if err != nil {
		t.Fatalf("CancelBoost on a stranded cancelled_by_seller row: %v — must be resumable, not stuck behind an illegal-transition error", err)
	}
	if cancelled.Status != BoostAutoRefunded {
		t.Errorf("Status = %q, want %q", cancelled.Status, BoostAutoRefunded)
	}
	if cancelled.RefundRef == nil {
		t.Error("RefundRef is nil, want stamped")
	}
	if cancelled.RefundedKobo == nil || *cancelled.RefundedKobo <= 0 {
		t.Errorf("RefundedKobo = %v, want a positive prorated amount", cancelled.RefundedKobo)
	}

	sellerBalAfter := boostWalletBalance(t, ctx, pool, seller)
	if sellerBalAfter <= sellerBalBefore {
		t.Errorf("seller balance did not increase (before=%d after=%d) — the missing refund leg must complete on resume", sellerBalBefore, sellerBalAfter)
	}
}
