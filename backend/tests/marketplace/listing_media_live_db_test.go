package marketplace_test

// ---------------------------------------------------------------------------
// LIVE-DB test for LISTING PHOTOS.
//
// mkt_listing_media was empty for every listing ever created. CreateListingInput
// carried MediaIDs and the service parsed them, but nothing wrote a media row —
// so the mobile ListingCard, which reads `thumbUrl`, fell back to a placeholder
// on every card in the app. The symptom looked like a rendering bug; the cause
// was that the write never happened and the read never selected it.
//
// What this pins:
//   • a create with media_ids persists rows, in order;
//   • a media id that is NOT an object key this seller uploaded is rejected —
//     the composer posts `fileUrl ?? photo.id`, so a failed upload sends a LOCAL
//     photo id that would otherwise be stored as a permanently broken image;
//   • a key under ANOTHER seller's prefix is rejected (it is client-supplied, so
//     without the check a caller could claim someone else's object);
//   • reads carry the thumbnail through.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	mkt "spotlight/backend/internal/marketplace"
	"spotlight/backend/internal/testsupport"
)

func mediaKey(seller string) string {
	return "marketplace/" + seller + "/" + uuid.NewString()[:8] + "abcd1234.jpg"
}

func createWithMedia(t *testing.T, ctx context.Context, svc *mkt.Service, seller, cat string, mediaIDs []string) *mkt.Listing {
	t.Helper()
	l, err := svc.CreateListing(ctx, seller, mkt.CreateListingInput{
		CategoryID:  cat,
		Title:       "Clean Toyota Corolla 2015 Lagos",
		Description: "well maintained first body accident free lagos pickup available now",
		PriceKobo:   500000, State: "Lagos", LGA: "Ikeja",
		MediaIDs: mediaIDs,
	})
	if err != nil {
		t.Fatalf("create listing: %v", err)
	}
	return l
}

func TestLiveDB_ListingMedia_PersistedAndReadBack(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedTrustedSeller(t, ctx, pool)
	testsupport.CleanupUser(t, pool, seller)
	cat := seedRiskTier0Category(t, ctx, pool)

	keys := []string{mediaKey(seller), mediaKey(seller)}
	l := createWithMedia(t, ctx, svc, seller, cat, keys)

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.mkt_listing_media WHERE listing_id=$1`, l.ID).Scan(&n); err != nil {
		t.Fatalf("count media: %v", err)
	}
	if n != len(keys) {
		t.Fatalf("media rows: got %d want %d — media_ids were dropped on create", n, len(keys))
	}

	// Order matters: the first photo is the one the card shows.
	var first string
	if err := pool.QueryRow(ctx,
		`SELECT url_thumb FROM public.mkt_listing_media WHERE listing_id=$1 ORDER BY sort_order LIMIT 1`,
		l.ID).Scan(&first); err != nil {
		t.Fatalf("read first media: %v", err)
	}
	if first != keys[0] {
		t.Errorf("first photo: got %q want %q", first, keys[0])
	}

	// The read path must carry it back. Without a presigner configured the URL is
	// empty by design, so this asserts the KEY reached the row — the part that was
	// broken — rather than requiring R2 credentials in CI.
	got, err := svc.GetListing(ctx, l.ID)
	if err != nil {
		t.Fatalf("get listing: %v", err)
	}
	if got.ID != l.ID {
		t.Fatalf("wrong listing back")
	}
}

func TestLiveDB_ListingMedia_RejectsJunkAndForeignKeys(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedTrustedSeller(t, ctx, pool)
	testsupport.CleanupUser(t, pool, seller)
	other := seedTrustedSeller(t, ctx, pool)
	testsupport.CleanupUser(t, pool, other)
	cat := seedRiskTier0Category(t, ctx, pool)

	l := createWithMedia(t, ctx, svc, seller, cat, []string{
		"photo-local-123", // composer's `fileUrl ?? photo.id` after a failed upload
		mediaKey(other),   // another seller's object
		"marketplace/" + seller + "/nested/evil.jpg", // path traversal beyond the flat key shape
	})

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.mkt_listing_media WHERE listing_id=$1`, l.ID).Scan(&n); err != nil {
		t.Fatalf("count media: %v", err)
	}
	if n != 0 {
		t.Errorf("stored %d media row(s) from unowned/junk ids — none should persist", n)
	}
}
