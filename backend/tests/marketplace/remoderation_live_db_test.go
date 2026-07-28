package marketplace_test

// ---------------------------------------------------------------------------
// LIVE-DB behavioral test for edit-after-approve RE-MODERATION (marketplace trust
// backbone: LM-002 / MOD-010 / EC-010). Per the test plan §0.4, a trust/moderation
// case requires an EXECUTED assertion — so this drives the real Service against a
// live Postgres (the first wired marketplace live-DB test; the older sequence_flow
// tests only skip). Skipped unless MARKETPLACE_TEST_DATABASE_URL / TEST_DATABASE_URL
// / DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	mkt "spotlight/backend/internal/marketplace"
)

func liveMktService(t *testing.T) (*mkt.Service, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("MARKETPLACE_TEST_DATABASE_URL")
	for _, k := range []string{"TEST_DATABASE_URL", "DATABASE_URL"} {
		if dsn == "" {
			dsn = os.Getenv(k)
		}
	}
	if dsn == "" {
		t.Skip("no MARKETPLACE_TEST_DATABASE_URL/TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB marketplace test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	return mkt.NewService(pool, led, (*goredis.Client)(nil)), pool
}

// seedRiskTier0Category inserts an auto-approvable (risk_tier 0) category and returns its id.
func seedRiskTier0Category(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO mkt_categories (id, market_id, slug, name, attribute_schema, risk_tier, commission_bps, is_active)
		 VALUES ($1::uuid,'paymax','remod-'||$1::text,'Remod Test Cat','{}'::jsonb,0,0,true)`, id); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	return id
}

// activate creates → submits → (approves if needed) a listing, returning it ACTIVE.
func activate(t *testing.T, ctx context.Context, svc *mkt.Service, seller, admin, cat, title string, price int64) *mkt.Listing {
	t.Helper()
	l, err := svc.CreateListing(ctx, seller, mkt.CreateListingInput{
		CategoryID: cat, Title: title,
		Description: "well maintained first body accident free lagos pickup available now",
		PriceKobo:   price, State: "Lagos", LGA: "Ikeja",
	})
	if err != nil {
		t.Fatalf("create listing: %v", err)
	}
	sub, err := svc.SubmitListing(ctx, seller, l.ID)
	if err != nil {
		t.Fatalf("submit listing: %v", err)
	}
	if sub.Status == mkt.ListingPendingReview {
		if _, err := svc.ApproveListing(ctx, admin, l.ID, "approved"); err != nil {
			t.Fatalf("approve listing: %v", err)
		}
	}
	return l
}

func TestLiveDB_EditAfterApprove_ReModeration(t *testing.T) {
	svc, pool := liveMktService(t)
	defer pool.Close()
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)
	seller := uuid.New().String()
	admin := uuid.New().String()

	// --- Content edit (title) on a LIVE listing must re-enter moderation (LM-002). ---
	l := activate(t, ctx, svc, seller, admin, cat, "Clean Toyota Corolla 2015 Lagos", 500000000)
	bait := "FREE giveaway message my whatsapp 08000000000 now"
	edited, err := svc.UpdateListing(ctx, seller, l.ID, mkt.UpdateListingInput{Title: &bait})
	if err != nil {
		t.Fatalf("edit content: %v", err)
	}
	if edited.Status != mkt.ListingPendingReview {
		t.Fatalf("content edit on a live listing = status %s, want pending_review (re-moderation)", edited.Status)
	}
	// It must be PULLED from discovery (an outbox delete op) until re-approved.
	var delOps int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM mkt_listings_outbox WHERE listing_id=$1 AND op='delete'`, l.ID).Scan(&delOps)
	if delOps < 1 {
		t.Error("re-moderated listing must be removed from search (no outbox delete op emitted)")
	}
	// And it must be AUDITED.
	var audits int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM mkt_admin_audit_log WHERE target_id=$1 AND action='mkt.listing.edit_remoderate'`, l.ID).Scan(&audits)
	if audits < 1 {
		t.Error("re-moderation must write an audit event")
	}

	// --- Price-only edit on a LIVE listing must NOT re-moderate (normal seller action). ---
	l2 := activate(t, ctx, svc, seller, admin, cat, "Another Clean Corolla 2016 Lagos", 600000000)
	newPrice := int64(550000000)
	edited2, err := svc.UpdateListing(ctx, seller, l2.ID, mkt.UpdateListingInput{PriceKobo: &newPrice})
	if err != nil {
		t.Fatalf("edit price: %v", err)
	}
	if edited2.Status != mkt.ListingActive {
		t.Errorf("price-only edit = status %s, want still active (must not re-moderate)", edited2.Status)
	}

	// --- A non-owner cannot edit the listing (IDOR, LM-009). ---
	stranger := uuid.New().String()
	if _, err := svc.UpdateListing(ctx, stranger, l2.ID, mkt.UpdateListingInput{Title: &bait}); err == nil {
		t.Error("a non-owner editing the listing must be forbidden")
	}
}
