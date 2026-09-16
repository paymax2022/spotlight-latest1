package marketplace_test

import (
	"context"
	"strings"
	"testing"
	"time"

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

// Renew had no route, handler, or service method at all — the FSM has always
// documented expired → active as "renew" (fsm_listing.go) and the mobile
// client has called POST /listings/:id/renew since the Sell group was built,
// but nothing on the backend ever implemented it, so every renew 404ed and an
// expired listing had no way back to active. Same class of gap as MarkSold's
// history (see its doc comment above).
func TestListingActions_Renew(t *testing.T) {
	ctx := context.Background()
	_, pool := liveConnectService(t)
	svc, seller, id := seedActiveOwnedListing(t, ctx)

	if _, err := pool.Exec(ctx, `UPDATE public.mkt_listings SET status='expired', expires_at=now()-interval '1 day' WHERE id=$1`, id); err != nil {
		t.Fatalf("stage expired: %v", err)
	}

	renewed, err := svc.RenewListing(ctx, seller, id)
	if err != nil {
		t.Fatalf("RenewListing: %v", err)
	}
	if renewed.Status != mkt.ListingActive {
		t.Errorf("status = %q, want active", renewed.Status)
	}
	if !renewed.ExpiresAt.After(time.Now().Add(59 * 24 * time.Hour)) {
		t.Errorf("expires_at = %v, want pushed out ~60 days from renewal, not left in the past", renewed.ExpiresAt)
	}
}

// A listing that is NOT expired (e.g. still active, or merely paused) must not
// be renewable — renew is specifically the expired → active edge, not a
// generic "force to active" escape hatch that could bypass moderation on a
// draft/pending_review listing.
func TestListingActions_RenewRejectsNonExpired(t *testing.T) {
	ctx := context.Background()
	svc, seller, id := seedActiveOwnedListing(t, ctx)

	if _, err := svc.RenewListing(ctx, seller, id); err == nil {
		t.Fatal("renewed a listing that was still active")
	}
}

// Only the owner may renew it.
func TestListingActions_RenewRejectsNonOwner(t *testing.T) {
	ctx := context.Background()
	svc, _, id := seedActiveOwnedListing(t, ctx)
	_, pool := liveConnectService(t)

	if _, err := pool.Exec(ctx, `UPDATE public.mkt_listings SET status='expired', expires_at=now()-interval '1 day' WHERE id=$1`, id); err != nil {
		t.Fatalf("stage expired: %v", err)
	}
	if _, err := svc.RenewListing(ctx, uuid.NewString(), id); err == nil {
		t.Fatal("a stranger renewed someone else's listing")
	}
}
