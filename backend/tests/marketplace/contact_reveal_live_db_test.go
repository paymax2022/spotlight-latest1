package marketplace_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	mkt "spotlight/backend/internal/marketplace"
)

// seedListingWithSellerPhone returns an active listing whose seller has a phone.
func seedListingWithSellerPhone(t *testing.T, ctx context.Context, phone string) (svc *mkt.Service, seller, viewer, listingID string) {
	t.Helper()
	svc, pool := liveConnectService(t)
	cat := seedCategoryInMarket(t, ctx, pool, "NG")

	mkUser := func() string {
		id := uuid.NewString()
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			id, id+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, id)
		})
		return id
	}
	seller, viewer = mkUser(), mkUser()

	if _, err := pool.Exec(ctx,
		`INSERT INTO public.user_profiles (id, email, phone) VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone`,
		seller, seller+"@seed.test", phone); err != nil {
		t.Fatalf("seed seller profile: %v", err)
	}

	l, err := svc.CreateListing(ctx, seller, mkt.CreateListingInput{
		CategoryID:  cat,
		Title:       "Contact reveal fixture",
		Description: "This description is comfortably longer than the eight word minimum.",
		PriceKobo:   500000,
		State:       "Lagos",
	})
	if err != nil {
		t.Fatalf("CreateListing: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		if _, err := pool.Exec(bg, `DELETE FROM public.mkt_contact_reveals WHERE listing_id=$1`, l.ID); err != nil {
			t.Errorf("cleanup reveals: %v", err)
		}
		if _, err := pool.Exec(bg, `DELETE FROM public.mkt_listings_outbox WHERE listing_id=$1`, l.ID); err != nil {
			t.Errorf("cleanup outbox: %v", err)
		}
		if _, err := pool.Exec(bg, `DELETE FROM public.mkt_listings WHERE id=$1`, l.ID); err != nil {
			t.Errorf("cleanup listing: %v", err)
		}
	})
	return svc, seller, viewer, l.ID
}

func TestContactReveal_ReturnsTheSellerNumber(t *testing.T) {
	ctx := context.Background()
	svc, seller, viewer, id := seedListingWithSellerPhone(t, ctx, "08031234567")

	c, err := svc.RevealSellerContact(ctx, viewer, id)
	if err != nil {
		t.Fatalf("RevealSellerContact: %v", err)
	}
	if c.Phone != "08031234567" {
		t.Errorf("phone = %q, want 08031234567", c.Phone)
	}
	if c.SellerID != seller {
		t.Errorf("sellerId = %q, want %q", c.SellerID, seller)
	}
}

// A seller with no number must not produce a blank reveal that looks like success.
func TestContactReveal_SellerWithoutPhone(t *testing.T) {
	ctx := context.Background()
	svc, _, viewer, id := seedListingWithSellerPhone(t, ctx, "")

	_, err := svc.RevealSellerContact(ctx, viewer, id)
	if err == nil {
		t.Fatal("a seller with no phone produced a successful reveal")
	}
	if !strings.Contains(err.Error(), "SELLER_HAS_NO_PHONE") {
		t.Errorf("error = %q, want SELLER_HAS_NO_PHONE", err.Error())
	}
}

// The budget is the only thing between a scraper and every number in the market.
func TestContactReveal_RateLimitsAcrossListings(t *testing.T) {
	ctx := context.Background()
	svc, pool := liveConnectService(t)
	cat := seedCategoryInMarket(t, ctx, pool, "NG")

	viewer := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		viewer, viewer+"@seed.test"); err != nil {
		t.Fatalf("seed viewer: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, viewer) })

	// 11 distinct listings, each a different seller with a number: the 11th must
	// be refused because the hourly budget is 10.
	for i := 0; i < 11; i++ {
		seller := uuid.NewString()
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			seller, seller+"@seed.test"); err != nil {
			t.Fatalf("seed seller: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO public.user_profiles (id, email, phone) VALUES ($1,$2,$3)
			 ON CONFLICT (id) DO UPDATE SET phone=EXCLUDED.phone`,
			seller, seller+"@seed.test", fmt.Sprintf("0803000%04d", i)); err != nil {
			t.Fatalf("seed seller profile: %v", err)
		}
		l, err := svc.CreateListing(ctx, seller, mkt.CreateListingInput{
			CategoryID:  cat,
			Title:       "Contact reveal fixture",
			Description: "This description is comfortably longer than the eight word minimum.",
			PriceKobo:   500000,
			State:       "Lagos",
		})
		if err != nil {
			t.Fatalf("CreateListing %d: %v", i, err)
		}
		id, sid := l.ID, seller
		t.Cleanup(func() {
			bg := context.Background()
			_, _ = pool.Exec(bg, `DELETE FROM public.mkt_contact_reveals WHERE listing_id=$1`, id)
			_, _ = pool.Exec(bg, `DELETE FROM public.mkt_listings_outbox WHERE listing_id=$1`, id)
			_, _ = pool.Exec(bg, `DELETE FROM public.mkt_listings WHERE id=$1`, id)
			_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id=$1`, sid)
		})

		_, err = svc.RevealSellerContact(ctx, viewer, l.ID)
		switch {
		case i < 10 && err != nil:
			t.Fatalf("reveal %d of 10 was refused: %v", i+1, err)
		case i == 10 && err == nil:
			t.Fatal("the 11th reveal in an hour was allowed; the budget is 10")
		case i == 10 && !strings.Contains(err.Error(), "CONTACT_REVEAL_LIMIT"):
			t.Errorf("11th reveal error = %q, want CONTACT_REVEAL_LIMIT", err.Error())
		}
	}
}

// Re-opening a listing you already revealed must not spend budget again.
func TestContactReveal_RepeatOfSameListingIsFree(t *testing.T) {
	ctx := context.Background()
	svc, _, viewer, id := seedListingWithSellerPhone(t, ctx, "08031234567")

	for i := 0; i < 15; i++ {
		if _, err := svc.RevealSellerContact(ctx, viewer, id); err != nil {
			t.Fatalf("repeat reveal %d of the same listing was refused: %v", i+1, err)
		}
	}
}

// Every reveal is recorded, including repeats — the seller must be able to ask
// who was given their number.
func TestContactReveal_IsRecordedForAbuseReports(t *testing.T) {
	ctx := context.Background()
	svc, pool := liveConnectService(t)
	_ = pool
	svc2, seller, viewer, id := seedListingWithSellerPhone(t, ctx, "08031234567")
	_ = svc

	for i := 0; i < 3; i++ {
		if _, err := svc2.RevealSellerContact(ctx, viewer, id); err != nil {
			t.Fatalf("reveal: %v", err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.mkt_contact_reveals WHERE listing_id=$1 AND viewer_id=$2 AND seller_id=$3`,
		id, viewer, seller).Scan(&n); err != nil {
		t.Fatalf("count reveals: %v", err)
	}
	if n != 3 {
		t.Errorf("recorded %d reveals, want 3 — repeats must be recorded too", n)
	}
}
