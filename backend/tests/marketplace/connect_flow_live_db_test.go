package marketplace_test

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the ADR-023 "listings-and-connect" flow that
// actually ships: messaging → offers → mark-met → review, plus object-level
// authorization (a non-participant/stranger is denied). This replaces the value
// the old escrow/order/dispute suite used to carry (those flows were removed;
// their tests are historical stubs). Drives the real marketplace.Service against
// a real Postgres.
//
// SKIPPED whenever MARKETPLACE_TEST_DATABASE_URL (or DATABASE_URL) is unset, so
// `go test ./...` without a DB stays green. Self-contained: it seeds a minimal
// category + active listing, exercises the flow, and cleans up.
//
// Bring-up: apply marketplace migrations incl. 20261006000000 (messaging) and
// 20261007000000 (deal reviews), then:
//   export MARKETPLACE_TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/marketplace/... -run ConnectFlow -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	mkt "spotlight/backend/internal/marketplace"
)

// liveConnectService builds the real marketplace service against the test DB, or
// skips. Returns the service + the pool (for fixture seeding/cleanup).
func liveConnectService(t *testing.T) (*mkt.Service, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("MARKETPLACE_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no MARKETPLACE_TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB connect-flow test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// The connect-flow methods (messaging/offers/reviews) are pure DB — no ledger
	// or redis path — but NewService requires a ledger; build a real one on the pool.
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	return mkt.NewService(pool, ledgerSvc, nil), pool
}

// seedActiveListing inserts a minimal category + an ACTIVE listing owned by seller.
func seedActiveListing(t *testing.T, ctx context.Context, pool *pgxpool.Pool, seller string) (catID, listingID string) {
	t.Helper()
	catID = uuid.NewString()
	listingID = uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.mkt_categories (id, slug, name) VALUES ($1,$2,$3)`,
		catID, "test-cat-"+catID[:8], "Connect Flow Test Category"); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.mkt_listings (id, seller_id, category_id, title, description, price_kobo, state, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
		listingID, seller, catID,
		"Connect Flow Test Listing Item",
		"This is a valid listing description with more than eight words present.",
		500000, "Lagos"); err != nil {
		t.Fatalf("seed listing: %v", err)
	}
	return catID, listingID
}

func TestConnectFlow_LiveDB(t *testing.T) {
	ctx := context.Background()
	svc, pool := liveConnectService(t)
	defer pool.Close()

	// mkt_listings.seller_id (and thread/offer actor columns) are uuid — use bare UUIDs.
	seller := uuid.NewString()
	buyer := uuid.NewString()
	stranger := uuid.NewString()
	catID, listingID := seedActiveListing(t, ctx, pool, seller)

	t.Cleanup(func() {
		// Children first (FKs), then parents. Thread id resolved by listing/buyer.
		_, _ = pool.Exec(ctx, `DELETE FROM public.mkt_deal_reviews WHERE thread_id IN (SELECT id FROM public.mkt_threads WHERE listing_id=$1)`, listingID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.mkt_messages WHERE thread_id IN (SELECT id FROM public.mkt_threads WHERE listing_id=$1)`, listingID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.mkt_threads WHERE listing_id=$1`, listingID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.mkt_offers WHERE listing_id=$1`, listingID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.mkt_listings WHERE id=$1`, listingID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.mkt_categories WHERE id=$1`, catID)
	})

	// ── Messaging: buyer opens the thread ───────────────────────────────────────
	thread, err := svc.StartOrGetThread(ctx, buyer, listingID, "Hi, is this still available?")
	if err != nil {
		t.Fatalf("start thread: %v", err)
	}
	if thread.CounterpartyID != seller {
		t.Fatalf("buyer's counterparty: got %q want seller %q", thread.CounterpartyID, seller)
	}
	if thread.MyRole != "buyer" {
		t.Fatalf("buyer's role: got %q want buyer", thread.MyRole)
	}
	if _, err := svc.SendMessage(ctx, buyer, thread.ID, "Second message"); err != nil {
		t.Fatalf("send message: %v", err)
	}

	// ── Object-level auth: a stranger is denied the thread ──────────────────────
	if _, gerr := svc.GetThread(ctx, stranger, thread.ID); !errors.Is(gerr, mkt.ErrThreadNotFound) {
		t.Fatalf("stranger GetThread: want ErrThreadNotFound, got %v", gerr)
	}
	if _, serr := svc.SendMessage(ctx, stranger, thread.ID, "intrude"); serr == nil {
		t.Fatalf("stranger SendMessage: want error, got nil")
	}

	// ── Offers: buyer proposes; seller sees it, a stranger sees none ────────────
	if _, oerr := svc.CreateOffer(ctx, buyer, listingID, 400000, "Would you take ₦4,000?"); oerr != nil {
		t.Fatalf("create offer: %v", oerr)
	}
	sellerView, err := svc.ListOffersForListing(ctx, seller, listingID)
	if err != nil {
		t.Fatalf("seller list offers: %v", err)
	}
	if len(sellerView) != 1 {
		t.Fatalf("seller should see 1 offer, got %d", len(sellerView))
	}
	strangerView, err := svc.ListOffersForListing(ctx, stranger, listingID)
	if err != nil {
		t.Fatalf("stranger list offers: %v", err)
	}
	if len(strangerView) != 0 {
		t.Fatalf("stranger (non-seller) should see 0 offers, got %d", len(strangerView))
	}

	// ── Reviews are gated on the "mark met" signal ──────────────────────────────
	if _, rerr := svc.SubmitDealReview(ctx, buyer, thread.ID, 5, nil, "great"); rerr == nil {
		t.Fatalf("review before mark-met: want error, got nil")
	}
	if merr := svc.MarkDealMet(ctx, buyer, thread.ID); merr != nil {
		t.Fatalf("mark met: %v", merr)
	}
	review, err := svc.SubmitDealReview(ctx, buyer, thread.ID, 5, []string{"friendly"}, "Great deal, smooth meetup")
	if err != nil {
		t.Fatalf("submit review after met: %v", err)
	}
	if review.RevieweeID != seller {
		t.Fatalf("reviewee: got %q want seller %q", review.RevieweeID, seller)
	}

	// ── Read back + duplicate is rejected ───────────────────────────────────────
	got, ok, err := svc.GetDealReview(ctx, buyer, thread.ID)
	if err != nil || !ok {
		t.Fatalf("get review: ok=%v err=%v", ok, err)
	}
	if got.Rating == nil || *got.Rating != 5 {
		t.Fatalf("review rating not persisted as 5: %+v", got.Rating)
	}
	if _, derr := svc.SubmitDealReview(ctx, buyer, thread.ID, 4, nil, "again"); !errors.Is(derr, mkt.ErrReviewExists) {
		t.Fatalf("duplicate review: want ErrReviewExists, got %v", derr)
	}
}
