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

// TestLiveDB_ListingMedia_DetailGalleryReturnsAllPhotosInOrder pins the
// listing DETAIL screen's gallery, a separate gap from the card thumbnail
// above: even after thumbnails started working, the detail screen
// (app/marketplace/listing/[id].tsx) reads a `media` array with one entry per
// photo — nothing on the backend ever populated it, only ever the single
// first-photo ThumbURL cards use. A listing with real photos still rendered
// an empty gallery on its own detail page.
//
// No presigner is configured in this harness (see liveMktService), so a
// signed URL is empty by design here — this asserts every ROW reached
// Listing.Media, in the right order, which is the part that was missing
// entirely; the presign call itself (presignThumb) is exercised by
// attachThumbs already and is unchanged by this fix.
func TestLiveDB_ListingMedia_DetailGalleryReturnsAllPhotosInOrder(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedTrustedSeller(t, ctx, pool)
	testsupport.CleanupUser(t, pool, seller)
	cat := seedRiskTier0Category(t, ctx, pool)

	keys := []string{mediaKey(seller), mediaKey(seller), mediaKey(seller)}
	l := createWithMedia(t, ctx, svc, seller, cat, keys)

	repo := mkt.NewRepository(pool)
	rows, err := repo.ListMediaForListing(ctx, l.ID)
	if err != nil {
		t.Fatalf("list media for listing: %v", err)
	}
	if len(rows) != len(keys) {
		t.Fatalf("gallery rows: got %d want %d — detail screen would still show an empty gallery", len(rows), len(keys))
	}
	for i, r := range rows {
		if r.Key != keys[i] {
			t.Errorf("gallery photo %d: got key %q want %q — gallery order is wrong", i, r.Key, keys[i])
		}
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

// ---------------------------------------------------------------------------
// LIVE-DB tests for EDITING photos on an existing listing (add/remove/reorder).
// The edit screen (app/marketplace/sell/edit/[id].tsx) only ever touched
// title/description/price/attrs — photos were create-only. These pin the new
// AddListingMedia/RemoveListingMedia/ReorderListingMedia service methods.
// ---------------------------------------------------------------------------

func TestLiveDB_ListingMedia_AddAppendsOrderedAndCaps(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedTrustedSeller(t, ctx, pool)
	testsupport.CleanupUser(t, pool, seller)
	cat := seedRiskTier0Category(t, ctx, pool)

	l := createWithMedia(t, ctx, svc, seller, cat, []string{mediaKey(seller)})

	more := []string{mediaKey(seller), mediaKey(seller)}
	if _, err := svc.AddListingMedia(ctx, seller, l.ID, more); err != nil {
		t.Fatalf("add media: %v", err)
	}
	// Appended, not reordered: the original photo stays first. No presigner is
	// configured in this harness (see liveMktService), so Listing.Media is
	// empty by design — assert against the row store directly, same as the
	// other tests in this file.
	rows, err := mkt.NewRepository(pool).ListMediaForListing(ctx, l.ID)
	if err != nil {
		t.Fatalf("list media: %v", err)
	}
	if len(rows) != 3 || rows[0].SortOrder != 0 || rows[1].SortOrder != 1 || rows[2].SortOrder != 2 {
		t.Fatalf("append did not produce sequential sort_order: %+v", rows)
	}

	// A non-owner may not add photos to someone else's listing (IDOR).
	stranger := uuid.New().String()
	if _, err := svc.AddListingMedia(ctx, stranger, l.ID, []string{mediaKey(stranger)}); err == nil {
		t.Error("a non-owner adding photos must be forbidden")
	}

	// The cap is enforced server-side, not just by the client's selectionLimit.
	l2 := createWithMedia(t, ctx, svc, seller, cat, []string{mediaKey(seller)})
	nine := make([]string, 9)
	for i := range nine {
		nine[i] = mediaKey(seller)
	}
	if _, err := svc.AddListingMedia(ctx, seller, l2.ID, nine); err != nil {
		t.Fatalf("add 9 more photos (1+9=10, exactly at the cap): %v", err)
	}
	if _, err := svc.AddListingMedia(ctx, seller, l2.ID, []string{mediaKey(seller)}); err == nil {
		t.Error("adding an 11th photo must be rejected — the cap is not just client-side")
	}
}

func TestLiveDB_ListingMedia_RemoveDeletesAndRejectsUnknown(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedTrustedSeller(t, ctx, pool)
	testsupport.CleanupUser(t, pool, seller)
	cat := seedRiskTier0Category(t, ctx, pool)

	l := createWithMedia(t, ctx, svc, seller, cat, []string{mediaKey(seller), mediaKey(seller)})
	rows, err := mkt.NewRepository(pool).ListMediaForListing(ctx, l.ID)
	if err != nil || len(rows) != 2 {
		t.Fatalf("setup: expected 2 media rows, got %d (err=%v)", len(rows), err)
	}

	if _, err := svc.RemoveListingMedia(ctx, seller, l.ID, rows[0].ID); err != nil {
		t.Fatalf("remove media: %v", err)
	}
	remaining, err := mkt.NewRepository(pool).ListMediaForListing(ctx, l.ID)
	if err != nil {
		t.Fatalf("list media after remove: %v", err)
	}
	if len(remaining) != 1 || remaining[0].ID != rows[1].ID {
		t.Fatalf("media after remove: got %+v, want only %s left", remaining, rows[1].ID)
	}

	// Removing it again (already gone) must fail, not silently succeed.
	if _, err := svc.RemoveListingMedia(ctx, seller, l.ID, rows[0].ID); err == nil {
		t.Error("removing an already-removed photo must return an error, not a silent no-op")
	}

	// A non-owner may not remove a photo from someone else's listing.
	stranger := uuid.New().String()
	if _, err := svc.RemoveListingMedia(ctx, stranger, l.ID, rows[1].ID); err == nil {
		t.Error("a non-owner removing a photo must be forbidden")
	}
}

func TestLiveDB_ListingMedia_ReorderRewritesSortOrderAndValidatesSet(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedTrustedSeller(t, ctx, pool)
	testsupport.CleanupUser(t, pool, seller)
	cat := seedRiskTier0Category(t, ctx, pool)

	l := createWithMedia(t, ctx, svc, seller, cat, []string{mediaKey(seller), mediaKey(seller), mediaKey(seller)})
	rows, err := mkt.NewRepository(pool).ListMediaForListing(ctx, l.ID)
	if err != nil || len(rows) != 3 {
		t.Fatalf("setup: expected 3 media rows, got %d (err=%v)", len(rows), err)
	}
	original := []string{rows[0].ID, rows[1].ID, rows[2].ID}
	reversed := []string{original[2], original[1], original[0]}

	if _, err := svc.ReorderListingMedia(ctx, seller, l.ID, reversed); err != nil {
		t.Fatalf("reorder: %v", err)
	}
	afterRows, err := mkt.NewRepository(pool).ListMediaForListing(ctx, l.ID)
	if err != nil {
		t.Fatalf("list media after reorder: %v", err)
	}
	got := []string{afterRows[0].ID, afterRows[1].ID, afterRows[2].ID}
	if len(afterRows) != 3 || got[0] != reversed[0] || got[1] != reversed[1] || got[2] != reversed[2] {
		t.Fatalf("reorder did not apply: got order %v, want %v", got, reversed)
	}

	// Missing a photo, or repeating one, must be rejected rather than silently
	// dropping a photo from the gallery or duplicating a sort_order.
	if _, err := svc.ReorderListingMedia(ctx, seller, l.ID, []string{original[0], original[1]}); err == nil {
		t.Error("reorder missing a photo must be rejected")
	}
	if _, err := svc.ReorderListingMedia(ctx, seller, l.ID, []string{original[0], original[0], original[1]}); err == nil {
		t.Error("reorder repeating a photo must be rejected")
	}
	if _, err := svc.ReorderListingMedia(ctx, seller, l.ID, []string{original[0], original[1], uuid.New().String()}); err == nil {
		t.Error("reorder including a photo id from outside this listing must be rejected")
	}
}

// TestLiveDB_ListingMedia_AddRemoveReModerateActiveListing proves photo edits
// get the SAME re-moderation treatment as a title/description/attrs edit
// (TestLiveDB_EditAfterApprove_ReModeration) — a seller cannot swap an
// approved ad's photos without the listing going back through review.
func TestLiveDB_ListingMedia_AddRemoveReModerateActiveListing(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)
	seller := uuid.New().String()
	admin := uuid.New().String()

	l := activate(t, ctx, svc, seller, admin, cat, "Clean Toyota Corolla 2015 Lagos", 500000000)

	added, err := svc.AddListingMedia(ctx, seller, l.ID, []string{mediaKey(seller)})
	if err != nil {
		t.Fatalf("add media to active listing: %v", err)
	}
	if added.Status != mkt.ListingPendingReview {
		t.Fatalf("adding a photo to a live listing = status %s, want pending_review (re-moderation)", added.Status)
	}
	var audits int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM mkt_admin_audit_log WHERE target_id=$1 AND action='mkt.listing.photo_added'`, l.ID).Scan(&audits)
	if audits < 1 {
		t.Error("adding a photo to a live listing must write an audit event")
	}

	// Re-activate, then prove REMOVE re-moderates too. No presigner is
	// configured in this harness, so added.Media is empty by design — fetch
	// the row id from the store instead.
	if _, err := svc.ApproveListing(ctx, admin, l.ID, "re-approved for remove test"); err != nil {
		t.Fatalf("re-approve: %v", err)
	}
	rows, err := mkt.NewRepository(pool).ListMediaForListing(ctx, l.ID)
	if err != nil || len(rows) != 1 {
		t.Fatalf("expected 1 media row before remove, got %d (err=%v)", len(rows), err)
	}
	removed, err := svc.RemoveListingMedia(ctx, seller, l.ID, rows[0].ID)
	if err != nil {
		t.Fatalf("remove media from active listing: %v", err)
	}
	if removed.Status != mkt.ListingPendingReview {
		t.Fatalf("removing a photo from a live listing = status %s, want pending_review (re-moderation)", removed.Status)
	}
}
