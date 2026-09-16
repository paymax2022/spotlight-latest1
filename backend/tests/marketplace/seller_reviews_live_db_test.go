package marketplace_test

// ---------------------------------------------------------------------------
// GET /sellers/:id/reviews (Service.SellerReviews) used to read the dead,
// order-keyed mkt_reviews table — no rows written to it since ADR-023 removed
// escrow orders — while every review since has been written to the
// thread-keyed mkt_deal_reviews table via SubmitDealReview. A seller's real,
// current reviews never reached their own storefront. This pins the fix:
// SellerReviews now reads mkt_deal_reviews (ListRevieweeDealReviews).
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestSellerReviews_ReadsLiveDealReviewsNotDeadTable(t *testing.T) {
	ctx := context.Background()
	svc, pool := liveConnectService(t)

	seller := uuid.NewString()
	buyer := uuid.NewString()
	_, listingID := seedActiveListing(t, ctx, pool, seller)

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.mkt_deal_reviews WHERE thread_id IN (SELECT id FROM public.mkt_threads WHERE listing_id=$1)`, listingID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.mkt_threads WHERE listing_id=$1`, listingID)
	})

	thread, err := svc.StartOrGetThread(ctx, buyer, listingID, "Is this still available?")
	if err != nil {
		t.Fatalf("start thread: %v", err)
	}
	if err := svc.MarkDealMet(ctx, buyer, thread.ID); err != nil {
		t.Fatalf("mark met: %v", err)
	}
	productQuality := 5
	submitted, err := svc.SubmitDealReview(ctx, buyer, thread.ID, 4, &productQuality, []string{"reliable"}, "Exactly as described")
	if err != nil {
		t.Fatalf("submit review: %v", err)
	}
	if submitted.RevieweeID != seller {
		t.Fatalf("precondition: review reviewee = %q, want seller %q", submitted.RevieweeID, seller)
	}

	reviews, err := svc.SellerReviews(ctx, seller, 20, 0)
	if err != nil {
		t.Fatalf("SellerReviews: %v", err)
	}
	if len(reviews) != 1 {
		t.Fatalf("SellerReviews returned %d review(s), want 1 — the review written via SubmitDealReview must reach this endpoint", len(reviews))
	}
	got := reviews[0]
	if got.DealID != thread.ID {
		t.Errorf("DealID = %q, want the thread id %q", got.DealID, thread.ID)
	}
	if got.Rating == nil || *got.Rating != 4 {
		t.Errorf("Rating = %+v, want 4", got.Rating)
	}
	if got.ProductQualityRating == nil || *got.ProductQualityRating != 5 {
		t.Errorf("ProductQualityRating = %+v, want 5 — the product-specific sub-score must round-trip through this endpoint too", got.ProductQualityRating)
	}
	if got.Comment == nil || *got.Comment != "Exactly as described" {
		t.Errorf("Comment = %+v, want the submitted text", got.Comment)
	}

	// A stranger's own review list must not include this seller's reviews.
	strangerReviews, err := svc.SellerReviews(ctx, uuid.NewString(), 20, 0)
	if err != nil {
		t.Fatalf("SellerReviews (stranger): %v", err)
	}
	if len(strangerReviews) != 0 {
		t.Errorf("an unrelated user's SellerReviews returned %d row(s), want 0", len(strangerReviews))
	}
}
