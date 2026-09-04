package marketplace_test

// ---------------------------------------------------------------------------
// LIVE-DB tests replacing two stubs that reported `ok` while asserting nothing.
//
// The stubs they replace were gated on newTestService(), whose constructor
// t.Skip()s unconditionally — so no environment could ever run them, and the
// bodies behind the gate were commented-out prose. A test that cannot fail is
// worse than an absent one: it reads as coverage in every CI lane, including
// the promotion to main that is meant to be the safety net for direct develop
// pushes.
//
// Both drive the REAL exported Service against live Postgres via liveMktService
// (remoderation_live_db_test.go), which is the harness in this package that
// actually works — it falls back from MARKETPLACE_TEST_DATABASE_URL to
// TEST_DATABASE_URL, so `TEST_DATABASE_URL=… go test ./tests/marketplace/...`
// executes them.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	mkt "spotlight/backend/internal/marketplace"
	"spotlight/backend/internal/testsupport"
)

// walletBalanceKobo reads the seller's wallet balance straight from the ledger
// projection, so the assertion is against posted entries rather than anything the
// marketplace service reports about itself.
func walletBalanceKobo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type IN ('CREDIT','REVERSAL_DEBIT') THEN le.amount_kobo
		                         ELSE -le.amount_kobo END), 0)
		  FROM ledger_accounts la
		  JOIN ledger_entries le ON le.account_id = la.id
		 WHERE la.user_id = $1::uuid AND la.type = 'user_wallet'`, userID).Scan(&bal)
	if err != nil {
		t.Fatalf("read wallet balance: %v", err)
	}
	return bal
}

// seedLedgerCapableSeller seeds a seller that can actually hold money.
//
// seedTrustedSeller writes only mkt_trust_scores, so its id has no auth.users
// row — and ledger_accounts.user_id references auth.users. Any test whose
// assertion reaches the ledger therefore fails on a foreign key AFTER the
// service has already half-completed its work, which is a confusing place to
// discover the seeding was thin. Cleanup is registered through testsupport so
// the row is removed when its write set allows.
func seedLedgerCapableSeller(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := seedTrustedSeller(t, ctx, pool)
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2) ON CONFLICT DO NOTHING`,
		id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// TestLiveDB_BoostOnRejectedListing_AutoRefundsSeller executes the §8 boost
// cascade: rejecting a listing must not leave the seller paying for a boost that
// promotes a policy-removed listing.
//
// This is the case the replaced stub flagged as possibly missing entirely ("if
// moderation rejection doesn't auto-cascade to active boosts, this is a real gap
// against §8's row"). The cascade does exist in RejectListing, but nothing
// executed it, so the money leg — a real ledger reversal, not just a status flip
// — was unverified.
func TestLiveDB_BoostOnRejectedListing_AutoRefundsSeller(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedLedgerCapableSeller(t, ctx, pool) // must hold a wallet: the refund is a real ledger posting
	admin := seedTrustedSeller(t, ctx, pool)        // any actor id; RejectListing only audits it
	cat := seedRiskTier0Category(t, ctx, pool)
	listing := activate(t, ctx, svc, seller, admin, cat, "Boosted then rejected", 500000)

	boostID := seedActiveBoost(t, ctx, pool, listing.ID, seller, "vip", "now()+interval '6 days'")

	// Precondition, set directly: RejectListing only writes from pending_review
	// (service_listing.go passes that as the from-state to SetListingStatus, and
	// the UPDATE is `WHERE status = from`). The FSM permits active →
	// removed_policy and the guard lets it through, so rejecting a LIVE listing
	// currently fails with a misleading "conflicting concurrent write" and the
	// cascade below never runs. That is a separate defect from the one this test
	// covers; putting the listing where reject actually works keeps this test
	// about the boost cascade rather than about that bug.
	if _, err := pool.Exec(ctx,
		`UPDATE mkt_listings SET status='pending_review'::listing_status WHERE id=$1::uuid`, listing.ID); err != nil {
		t.Fatalf("precondition: move listing to pending_review: %v", err)
	}
	before, err := svc.GetBoost(ctx, boostID)
	if err != nil {
		t.Fatalf("get boost: %v", err)
	}
	if before.Status != mkt.BoostActive {
		t.Fatalf("precondition: boost should start active, got %s", before.Status)
	}
	if before.PriceKobo <= 0 {
		t.Fatalf("precondition: a zero-price boost would post no reversal and prove nothing")
	}
	balBefore := walletBalanceKobo(t, ctx, pool, seller)

	if _, err := svc.RejectListing(ctx, admin, listing.ID, "prohibited_item"); err != nil {
		t.Fatalf("reject listing: %v", err)
	}

	after, err := svc.GetBoost(ctx, boostID)
	if err != nil {
		t.Fatalf("get boost after reject: %v", err)
	}
	if after.Status != mkt.BoostAutoRefunded {
		t.Errorf("boost status = %s, want %s — a rejected listing must not keep a live paid boost",
			after.Status, mkt.BoostAutoRefunded)
	}
	if after.RefundRef == nil || *after.RefundRef == "" {
		t.Error("RefundRef is empty — the refund must be traceable to a ledger reference")
	}

	// The money leg. A status flip without this is the failure mode that matters:
	// the seller stops being promoted AND stays charged.
	balAfter := walletBalanceKobo(t, ctx, pool, seller)
	if got, want := balAfter-balBefore, before.PriceKobo; got != want {
		t.Errorf("seller wallet moved %d kobo, want +%d (the boost price returned)", got, want)
	}
}

// TestLiveDB_VerifyID_IsIdempotentUpsertOnly executes the badge-permanence
// guarantee against the database: VerifyID is an upsert that only ever SETS, so a
// retried call after a provider timeout must not toggle an existing badge off.
//
// The structural sibling of this test proves it by reading service.go and noting
// no revoke method exists. That reasoning is sound but cannot catch a regression
// in the repository's SQL — an UPSERT written as an overwrite would satisfy the
// structural argument and still clear the badge. This runs it.
func TestLiveDB_VerifyID_IsIdempotentUpsertOnly(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	user := seedTrustedSeller(t, ctx, pool)

	if err := svc.VerifyID(ctx, user); err != nil {
		t.Fatalf("first VerifyID: %v", err)
	}
	first := verifiedIDBadge(t, ctx, pool, user)
	if !first {
		t.Fatal("verified_id_badge is false after VerifyID — the badge was never set")
	}

	// The retry a KYC provider outage produces.
	if err := svc.VerifyID(ctx, user); err != nil {
		t.Fatalf("second VerifyID must be idempotent, got: %v", err)
	}
	if !verifiedIDBadge(t, ctx, pool, user) {
		t.Error("verified_id_badge flipped to false on the second call — VerifyID is a toggle, not an upsert")
	}
}

func verifiedIDBadge(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) bool {
	t.Helper()
	var badge bool
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(verified_id_badge,false) FROM mkt_trust_scores WHERE user_id=$1::uuid`, userID,
	).Scan(&badge); err != nil {
		t.Fatalf("read trust_scores: %v", err)
	}
	return badge
}
