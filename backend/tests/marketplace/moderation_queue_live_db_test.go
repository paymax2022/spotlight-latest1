package marketplace_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	mkt "spotlight/backend/internal/marketplace"
)

// The moderation queue must actually return the listings waiting on it.
//
// Its SQL numbered the placeholders $2/$3 while passing only (limit, offset), so
// $1 was bound but never referenced and Postgres could not infer its type. Every
// call failed with 42P18 and the endpoint 500ed. The damage was not the error
// itself but its shape: an admin opening the queue saw nothing to review, which
// is indistinguishable from an empty queue, while listings sat in pending_review
// with no surface that showed them.
func TestModerationQueue_ReturnsPendingListings(t *testing.T) {
	svc, pool := liveConnectService(t)
	ctx := context.Background()
	cat := seedCategoryInMarket(t, ctx, pool, "NG")

	l, err := svc.CreateListing(ctx, uuid.NewString(), mkt.CreateListingInput{
		CategoryID:  cat,
		Title:       "Queue fixture listing",
		Description: "This description is comfortably longer than the eight word minimum.",
		PriceKobo:   500000,
		State:       "Lagos",
	})
	if err != nil {
		t.Fatalf("CreateListing: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.mkt_listings WHERE id=$1`, l.ID)
	})

	// A seller with no trust profile does not auto-approve, so the listing lands
	// in the queue — the exact path a real seller takes.
	if _, err := pool.Exec(ctx,
		`UPDATE public.mkt_listings SET status='pending_review' WHERE id=$1`, l.ID); err != nil {
		t.Fatalf("stage pending_review: %v", err)
	}

	got, err := svc.ModerationQueue(ctx, 50, 0)
	if err != nil {
		t.Fatalf("ModerationQueue returned an error: %v", err)
	}

	var found bool
	for _, item := range got {
		if item.ID == l.ID {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("queue returned %d listing(s) and none was the pending fixture %s", len(got), l.ID)
	}
}

// Paging must work rather than merely not error — offset is the second of the two
// arguments, and getting the numbering wrong is what broke this in the first place.
func TestModerationQueue_RespectsLimitAndOffset(t *testing.T) {
	svc, pool := liveConnectService(t)
	ctx := context.Background()
	cat := seedCategoryInMarket(t, ctx, pool, "NG")

	for i := 0; i < 2; i++ {
		l, err := svc.CreateListing(ctx, uuid.NewString(), mkt.CreateListingInput{
			CategoryID:  cat,
			Title:       "Queue paging fixture",
			Description: "This description is comfortably longer than the eight word minimum.",
			PriceKobo:   500000,
			State:       "Lagos",
		})
		if err != nil {
			t.Fatalf("CreateListing: %v", err)
		}
		id := l.ID
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM public.mkt_listings WHERE id=$1`, id)
		})
		if _, err := pool.Exec(ctx,
			`UPDATE public.mkt_listings SET status='pending_review' WHERE id=$1`, id); err != nil {
			t.Fatalf("stage pending_review: %v", err)
		}
	}

	first, err := svc.ModerationQueue(ctx, 1, 0)
	if err != nil {
		t.Fatalf("ModerationQueue(limit=1, offset=0): %v", err)
	}
	if len(first) != 1 {
		t.Fatalf("limit=1 returned %d listings", len(first))
	}

	second, err := svc.ModerationQueue(ctx, 1, 1)
	if err != nil {
		t.Fatalf("ModerationQueue(limit=1, offset=1): %v", err)
	}
	if len(second) != 1 {
		t.Fatalf("limit=1 offset=1 returned %d listings", len(second))
	}
	if first[0].ID == second[0].ID {
		t.Errorf("offset ignored: both pages returned %s", first[0].ID)
	}
}

// Guards the exact failure mode, so a future renumbering is caught by name.
func TestModerationQueue_DoesNotFailOnParameterTypes(t *testing.T) {
	svc, _ := liveConnectService(t)
	if _, err := svc.ModerationQueue(context.Background(), 10, 0); err != nil {
		if strings.Contains(err.Error(), "42P18") || strings.Contains(err.Error(), "determine data type") {
			t.Fatalf("placeholder numbering regressed: %v", err)
		}
		t.Fatalf("ModerationQueue: %v", err)
	}
}
