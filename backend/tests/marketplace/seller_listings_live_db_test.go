package marketplace_test

// ---------------------------------------------------------------------------
// GET /sellers/:id/listings (public, no auth) backed every "My Listings" self
// view AND every buyer-facing storefront view off the exact same query, with
// no status filter — a buyer browsing a seller's public portfolio could see
// that seller's drafts, pending_review, paused, and removed_user listings,
// not just what's actually for sale. These pin the split: SellerListings
// (public) now only returns active listings; MyListingsForSeller (the new
// authenticated GET /my-listings) still returns every status, since that's
// what the seller needs to manage the lifecycle of their own listings.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	mkt "spotlight/backend/internal/marketplace"
)

func TestSellerListings_PublicViewOnlyShowsActive(t *testing.T) {
	ctx := context.Background()
	svc, pool := liveConnectService(t)
	cat := seedCategoryInMarket(t, ctx, pool, "NG")
	seller := uuid.NewString()

	statuses := []mkt.ListingStatus{mkt.ListingDraft, mkt.ListingPendingReview, mkt.ListingActive, mkt.ListingPaused, mkt.ListingRemovedUser}
	ids := make(map[mkt.ListingStatus]string, len(statuses))
	for _, status := range statuses {
		l, err := svc.CreateListing(ctx, seller, mkt.CreateListingInput{
			CategoryID:  cat,
			Title:       "Seller listings visibility fixture " + string(status),
			Description: "This description is comfortably longer than the eight word minimum.",
			PriceKobo:   500000,
			State:       "Lagos",
		})
		if err != nil {
			t.Fatalf("CreateListing(%s): %v", status, err)
		}
		ids[status] = l.ID
		t.Cleanup(func(id string) func() {
			return func() {
				bg := context.Background()
				_, _ = pool.Exec(bg, `DELETE FROM public.mkt_listings_outbox WHERE listing_id=$1`, id)
				_, _ = pool.Exec(bg, `DELETE FROM public.mkt_listings WHERE id=$1`, id)
			}
		}(l.ID))
		if status != mkt.ListingDraft {
			if _, err := pool.Exec(ctx, `UPDATE public.mkt_listings SET status=$2 WHERE id=$1`, l.ID, string(status)); err != nil {
				t.Fatalf("stage %s: %v", status, err)
			}
		}
	}

	publicView, err := svc.SellerListings(ctx, seller, 20, 0)
	if err != nil {
		t.Fatalf("SellerListings (public): %v", err)
	}
	if len(publicView) != 1 {
		t.Fatalf("public storefront returned %d listing(s), want exactly 1 (only the active one): %+v", len(publicView), publicView)
	}
	if publicView[0].ID != ids[mkt.ListingActive] {
		t.Errorf("public storefront returned listing %s, want the active one %s", publicView[0].ID, ids[mkt.ListingActive])
	}
	for _, l := range publicView {
		if l.Status != mkt.ListingActive {
			t.Errorf("public storefront leaked a non-active listing: id=%s status=%s", l.ID, l.Status)
		}
	}

	selfView, err := svc.MyListingsForSeller(ctx, seller, 20, 0)
	if err != nil {
		t.Fatalf("MyListingsForSeller: %v", err)
	}
	if len(selfView) != len(statuses) {
		t.Fatalf("self view returned %d listing(s), want all %d statuses visible to their own seller", len(selfView), len(statuses))
	}
}
