package marketplace_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	mkt "spotlight/backend/internal/marketplace"
)

// seedActiveOwnedListing returns an ACTIVE listing owned by the returned seller.
func seedActiveOwnedListing(t *testing.T, ctx context.Context) (svc *mkt.Service, seller, id string) {
	t.Helper()
	svc, pool := liveConnectService(t)
	cat := seedCategoryInMarket(t, ctx, pool, "NG")
	seller = uuid.NewString()

	l, err := svc.CreateListing(ctx, seller, mkt.CreateListingInput{
		CategoryID:  cat,
		Title:       "Listing action fixture",
		Description: "This description is comfortably longer than the eight word minimum.",
		PriceKobo:   500000,
		State:       "Lagos",
	})
	if err != nil {
		t.Fatalf("CreateListing: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		// mkt_listings_outbox is ON DELETE NO ACTION and every status transition
		// writes a row into it, so deleting the listing alone fails with 23503.
		// The original version ignored that error and leaked three fixtures into
		// the shared local database before anyone noticed — hence both the
		// dependant sweep and the assertion below.
		if _, err := pool.Exec(bg, `DELETE FROM public.mkt_listings_outbox WHERE listing_id=$1`, l.ID); err != nil {
			t.Errorf("cleanup: outbox rows for %s: %v", l.ID, err)
		}
		if _, err := pool.Exec(bg, `DELETE FROM public.mkt_listings WHERE id=$1`, l.ID); err != nil {
			t.Errorf("cleanup: listing %s was left behind: %v", l.ID, err)
		}
	})
	if _, err := pool.Exec(ctx, `UPDATE public.mkt_listings SET status='active' WHERE id=$1`, l.ID); err != nil {
		t.Fatalf("stage active: %v", err)
	}
	return svc, seller, l.ID
}

// Mark as sold had no route at all: the client has posted to
// /listings/:id/mark-sold since the Sell group was built, and it 404ed, so a sold
// item stayed live in search.
func TestListingActions_MarkSold(t *testing.T) {
	ctx := context.Background()
	svc, seller, id := seedActiveOwnedListing(t, ctx)

	l, err := svc.MarkSoldListing(ctx, seller, id)
	if err != nil {
		t.Fatalf("MarkSoldListing: %v", err)
	}
	if l.Status != mkt.ListingSold {
		t.Errorf("status = %q, want sold", l.Status)
	}
}

// Only the owner may sell it out from under the listing.
func TestListingActions_MarkSoldRejectsNonOwner(t *testing.T) {
	ctx := context.Background()
	svc, _, id := seedActiveOwnedListing(t, ctx)

	if _, err := svc.MarkSoldListing(ctx, uuid.NewString(), id); err == nil {
		t.Fatal("a stranger marked someone else's listing sold")
	}
}

// sold is terminal — no outgoing edge — so a second call must be refused rather
// than silently re-stamping sold_at.
func TestListingActions_SoldIsTerminal(t *testing.T) {
	ctx := context.Background()
	svc, seller, id := seedActiveOwnedListing(t, ctx)

	if _, err := svc.MarkSoldListing(ctx, seller, id); err != nil {
		t.Fatalf("first MarkSoldListing: %v", err)
	}
	_, err := svc.MarkSoldListing(ctx, seller, id)
	if err == nil {
		t.Fatal("marking an already-sold listing sold again was accepted")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "transition") {
		t.Errorf("error = %q, want it to name the illegal transition", err.Error())
	}
}

// Pause and resume round-trip, so the two actions the seller screen offers
// alongside Mark as sold are covered by the same fixture shape.
func TestListingActions_PauseThenResume(t *testing.T) {
	ctx := context.Background()
	svc, seller, id := seedActiveOwnedListing(t, ctx)

	paused, err := svc.PauseListing(ctx, seller, id)
	if err != nil {
		t.Fatalf("PauseListing: %v", err)
	}
	if paused.Status != mkt.ListingPaused {
		t.Fatalf("status = %q, want paused", paused.Status)
	}

	resumed, err := svc.ResumeListing(ctx, seller, id)
	if err != nil {
		t.Fatalf("ResumeListing: %v", err)
	}
	if resumed.Status != mkt.ListingActive {
		t.Errorf("status = %q, want active", resumed.Status)
	}
}
