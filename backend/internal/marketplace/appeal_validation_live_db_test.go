package marketplace

// LIVE-DB tests for the POST /appeals standing-action gate + the notification
// not-found mapping — the DB-backed legs of the w9-marketplace probe fixes.
// (The DB-free input-validation matrix lives in service_admin_appeals_test.go.)
// Follows the same TEST_DATABASE_URL-gated pattern as
// service_boost_live_db_test.go / admin_makercheck_live_db_test.go.
// Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/... -run TestLiveDB_FileAppeal -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// seedAppealUser creates one synthetic member visible to every identity table
// the marketplace module reads: auth.users (mkt_listings.seller_id FK),
// user_profiles (tier reads), and platform_users (admin/user-basics reads).
// Cleanups run LIFO, so auth.users is registered FIRST — the mkt/platform
// rows must be gone before it is.
func seedAppealUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	testsupport.CleanupUser(t, pool, id)
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,3) ON CONFLICT (id) DO NOTHING`,
		id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user_profiles: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO platform_users (id, first_name, last_name, email, status) VALUES ($1,'Appeal','Test',$2,'active') ON CONFLICT (id) DO NOTHING`,
		id, id+"@appeal.test"); err != nil {
		t.Fatalf("seed platform_users: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM mkt_appeals WHERE appellant_id=$1`, id)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM mkt_user_moderation WHERE user_id=$1`, id)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM platform_users WHERE id=$1`, id)
	})
	return id
}

// seedListingStatus inserts a listing in an explicit status (seedActiveListing
// only produces 'active', but the appeal gate needs removed_policy too).
func seedListingStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sellerID, categoryID string, status ListingStatus) string {
	t.Helper()
	id := uuid.New().String()
	// A policy-removed row always carries the reason moderation stamped —
	// mirror that so the fixture matches what RejectListing writes.
	var reason *string
	if status == ListingRemovedPolicy {
		r := "policy_violation"
		reason = &r
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_listings
			(id, market_id, seller_id, category_id, title, description, price_kobo, currency,
			 condition, status, escrow_eligible, state, moderation_reason_code)
		VALUES ($1,'NG',$2,$3,'Appeal Test Listing Title','A perfectly ordinary listing description with eight whole words',
		        1000000,'NGN','used',$4,true,'Lagos',$5)`,
		id, sellerID, categoryID, string(status), reason); err != nil {
		t.Fatalf("seed listing (%s): %v", status, err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM mkt_listings WHERE id=$1`, id) })
	return id
}

// seedBoostStatus inserts a boost row in an explicit status with an optional
// rejection_reason_code — FileAppeal's boost gate keys on exactly those two
// columns (auto_refunded via 'seller_cancelled' is NOT a moderation action).
func seedBoostStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, listingID, sellerID string, status BoostStatus, reason *string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_boosts (id, listing_id, seller_id, tier, duration_days, price_kobo, weight, status, rejection_reason_code, ledger_charge_ref, starts_at, ends_at)
		VALUES ($1,$2,$3,'start',7,100000,1.0,$4,$5,$6,now(),now()+interval '7 days')`,
		id, listingID, sellerID, string(status), reason, "test:charge:"+id); err != nil {
		t.Fatalf("seed boost (%s): %v", status, err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM mkt_boosts WHERE id=$1`, id) })
	return id
}

func fileAppealExpect(t *testing.T, svc *Service, appellantID string, in CreateAppealInput) (*Appeal, error) {
	t.Helper()
	return svc.FileAppeal(context.Background(), appellantID, in)
}

// TestLiveDB_FileAppeal_StandingActionGate is the w9-marketplace bug-1 fix
// verified end to end: the three fabricated-appeal shapes the probe got 201s
// on (nonexistent target, foreign target, never-moderated target) now fail
// closed, and a real moderation action still files.
func TestLiveDB_FileAppeal_StandingActionGate(t *testing.T) {
	pool := makercheckTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil)

	appellantID := seedAppealUser(t, ctx, pool)
	strangerID := seedAppealUser(t, ctx, pool)
	catID := seedBoostCategory(t, ctx, pool)

	// ── nonexistent targets → 404 ──────────────────────────────────────────
	_, err := fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "listing", TargetID: uuid.New().String(),
		OriginalAction: "removed_policy", OriginalReasonCode: "X", AppellantNote: "n",
	})
	if !errors.Is(err, ErrListingNotFound) {
		t.Fatalf("nonexistent listing: want ErrListingNotFound, got %v", err)
	}

	// ── foreign listing → 403 ──────────────────────────────────────────────
	foreignListing := seedListingStatus(t, ctx, pool, strangerID, catID, ListingRemovedPolicy)
	_, err = fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "listing", TargetID: foreignListing,
		OriginalAction: "removed_policy", OriginalReasonCode: "X", AppellantNote: "n",
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign listing: want ErrForbidden, got %v", err)
	}

	// ── own listing, never moderated (active) → 422 NO_APPEALABLE_ACTION ───
	activeListing := seedListingStatus(t, ctx, pool, appellantID, catID, ListingActive)
	_, err = fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "listing", TargetID: activeListing,
		OriginalAction: "removed_policy", OriginalReasonCode: "X", AppellantNote: "n",
	})
	if !errors.Is(err, ErrNoAppealableAction) {
		t.Fatalf("never-moderated listing: want ErrNoAppealableAction, got %v", err)
	}

	// ── own listing genuinely removed_policy → files ───────────────────────
	removedListing := seedListingStatus(t, ctx, pool, appellantID, catID, ListingRemovedPolicy)
	a, err := fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "listing", TargetID: removedListing,
		OriginalAction: "removed_policy", OriginalReasonCode: "policy_violation", AppellantNote: "my listing was removed unfairly",
	})
	if err != nil {
		t.Fatalf("appeal on removed_policy listing should file, got %v", err)
	}
	if a.Status != "opened" || a.TargetID != removedListing {
		t.Fatalf("unexpected appeal row: %+v", a)
	}

	// ── boosts ─────────────────────────────────────────────────────────────
	// active boost: purchased, never rejected → 422.
	activeBoost := seedBoostStatus(t, ctx, pool, activeListing, appellantID, BoostActive, nil)
	if _, err = fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "boost", TargetID: activeBoost,
		OriginalAction: "rejected_with_reason", OriginalReasonCode: "X", AppellantNote: "n",
	}); !errors.Is(err, ErrNoAppealableAction) {
		t.Fatalf("active boost: want ErrNoAppealableAction, got %v", err)
	}

	// auto_refunded via the SELLER's own cancel — not a moderation action → 422.
	selfCancelled := boostSellerCancelReason
	cancelledBoost := seedBoostStatus(t, ctx, pool, activeListing, appellantID, BoostAutoRefunded, &selfCancelled)
	if _, err = fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "boost", TargetID: cancelledBoost,
		OriginalAction: "auto_refunded", OriginalReasonCode: "X", AppellantNote: "n",
	}); !errors.Is(err, ErrNoAppealableAction) {
		t.Fatalf("seller-cancelled boost: want ErrNoAppealableAction, got %v", err)
	}

	// auto_refunded via an ADMIN rejection (reason stamped by RejectBoost) → files.
	adminReason := "policy_violation"
	rejectedBoost := seedBoostStatus(t, ctx, pool, removedListing, appellantID, BoostAutoRefunded, &adminReason)
	if _, err = fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "boost", TargetID: rejectedBoost,
		OriginalAction: "rejected_with_reason", OriginalReasonCode: "policy_violation", AppellantNote: "boost was wrongly rejected",
	}); err != nil {
		t.Fatalf("appeal on rejected boost should file, got %v", err)
	}

	// ── user target ────────────────────────────────────────────────────────
	// active member (no moderation row) → 422.
	if _, err = fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "user", TargetID: appellantID,
		OriginalAction: "suspended", OriginalReasonCode: "X", AppellantNote: "n",
	}); !errors.Is(err, ErrNoAppealableAction) {
		t.Fatalf("non-suspended user: want ErrNoAppealableAction, got %v", err)
	}

	// nonexistent 'user' id that isn't the caller → 403 (self-check runs first,
	// so user existence is never leaked).
	if _, err = fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "user", TargetID: uuid.New().String(),
		OriginalAction: "suspended", OriginalReasonCode: "X", AppellantNote: "n",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign/nonexistent user target: want ErrForbidden, got %v", err)
	}

	// actually suspended → files (suspend executes immediately, no dual approval).
	if _, err := svc.ProposeUserStatus(ctx, uuid.New().String(), "test-role", appellantID,
		SetUserStatusInput{Action: "suspend", ReasonCode: "TEST_SUSPEND"}); err != nil {
		t.Fatalf("suspend appellant: %v", err)
	}
	if _, err = fileAppealExpect(t, svc, appellantID, CreateAppealInput{
		TargetType: "user", TargetID: appellantID,
		OriginalAction: "suspended", OriginalReasonCode: "TEST_SUSPEND", AppellantNote: "I was wrongly suspended",
	}); err != nil {
		t.Fatalf("appeal by suspended user should file, got %v", err)
	}
}

// TestLiveDB_Notifications_AbsentID_Is404 is the w9-marketplace bug-2 fix:
// PATCH/DELETE /notifications/:id on a well-formed but absent id must surface
// the coded 404 NOT_FOUND, not the raw driver error → 500 INTERNAL_ERROR.
// Same answer for an id owned by ANOTHER user — the user_id predicate makes
// foreign rows indistinguishable from absent ones (no existence leak).
func TestLiveDB_Notifications_AbsentID_Is404(t *testing.T) {
	pool := makercheckTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil)

	userID := seedAppealUser(t, ctx, pool)
	absent := uuid.New().String()

	if _, err := svc.MarkNotificationRead(ctx, userID, absent); err == nil {
		t.Fatal("mark-read on absent notification: expected error, got nil")
	} else if ce := asCoded(err); ce.Status != 404 || ce.Code != CodeNotFound {
		t.Fatalf("mark-read absent: got status=%d code=%q, want 404/%s", ce.Status, ce.Code, CodeNotFound)
	}

	if err := svc.DeleteNotification(ctx, userID, absent); err == nil {
		t.Fatal("delete on absent notification: expected error, got nil")
	} else if ce := asCoded(err); ce.Status != 404 || ce.Code != CodeNotFound {
		t.Fatalf("delete absent: got status=%d code=%q, want 404/%s", ce.Status, ce.Code, CodeNotFound)
	}

	// And the positive leg still works: a real notification marks read + deletes.
	n, err := svc.CreateNotification(ctx, userID, "new_offer", "hello", "body", nil, uuid.New().String())
	if err != nil {
		t.Fatalf("create notification: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM mkt_notifications WHERE id=$1`, n.ID)
	})
	if _, err := svc.MarkNotificationRead(ctx, userID, n.ID); err != nil {
		t.Fatalf("mark-read on real notification: %v", err)
	}
	if err := svc.DeleteNotification(ctx, userID, n.ID); err != nil {
		t.Fatalf("delete on real notification: %v", err)
	}
}

// TestLiveDB_ResumeListing_NotPaused_IsTransitionError kills the misleading
// 'conflicting concurrent write' 409 the probe hit: resuming an ACTIVE (never
// paused) listing must answer INVALID_LISTING_TRANSITION, not ErrConflict —
// the FROM-state check runs before the guarded UPDATE ever executes.
func TestLiveDB_ResumeListing_NotPaused_IsTransitionError(t *testing.T) {
	pool := makercheckTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil)

	sellerID := seedAppealUser(t, ctx, pool)
	catID := seedBoostCategory(t, ctx, pool)
	listingID := seedListingStatus(t, ctx, pool, sellerID, catID, ListingActive)

	_, err := svc.ResumeListing(ctx, sellerID, listingID)
	if err == nil {
		t.Fatal("resume on an active listing: expected error, got nil")
	}
	if errors.Is(err, ErrConflict) {
		t.Fatalf("resume answered phantom write-race ErrConflict; want INVALID_LISTING_TRANSITION (got %v)", err)
	}
	if ce := asCoded(err); ce.Status != 409 || ce.Code != CodeInvalidListingTransition {
		t.Fatalf("resume on active listing: got status=%d code=%q, want 409/%s", ce.Status, ce.Code, CodeInvalidListingTransition)
	}

	// The real path still works: paused → active.
	pausedListing := seedListingStatus(t, ctx, pool, sellerID, catID, ListingPaused)
	if _, err := svc.ResumeListing(ctx, sellerID, pausedListing); err != nil {
		t.Fatalf("resume on a paused listing: %v", err)
	}
}
