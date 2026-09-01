package marketplace_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	mkt "spotlight/backend/internal/marketplace"
)

// Titles shorter than ten characters are legitimate and must publish.
//
// Publishing failed with 400 "title must be 10–100 characters" on a title the
// compose screen had already accepted: compose.tsx gated on >= 6 characters while
// both the service and the mkt_listings_title_check CHECK required >= 10, so the
// Publish button enabled itself for titles the server was always going to refuse.
// Migration 20270157000000 drops the minimum; these cover the service side and,
// because the insert really happens, the database constraint with it.
func TestListingTitle_ShortTitlesArePublishable(t *testing.T) {
	svc, pool := liveConnectService(t)
	ctx := context.Background()
	cat := seedCategoryInMarket(t, ctx, pool, "NG")

	// The shapes a seller actually types. "Sofa" is four characters and was
	// rejected before; each of these is under the old ten-character floor.
	for _, title := range []string{"Sofa", "iPhone 15", "Bike", "TV"} {
		t.Run(title, func(t *testing.T) {
			l, err := svc.CreateListing(ctx, uuid.NewString(), mkt.CreateListingInput{
				CategoryID:  cat,
				Title:       title,
				Description: "This description is comfortably longer than the eight word minimum.",
				PriceKobo:   500000,
				State:       "Lagos",
			})
			if err != nil {
				t.Fatalf("CreateListing rejected %q: %v", title, err)
			}
			t.Cleanup(func() {
				_, _ = pool.Exec(context.Background(), `DELETE FROM public.mkt_listings WHERE id=$1`, l.ID)
			})
			if l.Title != title {
				t.Errorf("stored title = %q, want %q", l.Title, title)
			}
		})
	}
}

// The ceiling is deliberately kept: it is what stops a title overflowing the
// fixed-height listing card. Removing the floor must not remove this too.
func TestListingTitle_EmptyAndOverlongAreStillRefused(t *testing.T) {
	svc, pool := liveConnectService(t)
	ctx := context.Background()
	cat := seedCategoryInMarket(t, ctx, pool, "NG")

	for name, title := range map[string]string{
		"empty":      "",
		"whitespace": "   ",
		"101 chars":  strings.Repeat("x", 101),
	} {
		t.Run(name, func(t *testing.T) {
			l, err := svc.CreateListing(ctx, uuid.NewString(), mkt.CreateListingInput{
				CategoryID:  cat,
				Title:       title,
				Description: "This description is comfortably longer than the eight word minimum.",
				PriceKobo:   500000,
				State:       "Lagos",
			})
			if err == nil {
				_, _ = pool.Exec(context.Background(), `DELETE FROM public.mkt_listings WHERE id=$1`, l.ID)
				t.Fatalf("CreateListing accepted a %s title", name)
			}
			if !strings.Contains(strings.ToLower(err.Error()), "title") {
				t.Errorf("error = %q, want it to name the title field", err.Error())
			}
		})
	}
}
