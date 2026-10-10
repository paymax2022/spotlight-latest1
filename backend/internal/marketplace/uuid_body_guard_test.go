package marketplace

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// The path-param half of the uuid guard lives in uuid_guard_test.go. This file
// locks the OTHER half: ids that arrive in request BODIES and QUERY strings —
// where UUIDParams never sees them — must also be refused as 400 VALIDATION
// instead of reaching a uuid column and escaping as a 500 "invalid input
// syntax for type uuid". Every case below constructs a Service with no
// repository backend on purpose: each assertion must return BEFORE the first
// query, so a nil pool would panic if the guard regressed and let the value
// through.

func assertFieldErr(t *testing.T, err error, field string) {
	t.Helper()
	if err == nil {
		t.Fatalf("want a 400 field error on %q, got nil", field)
	}
	var ce *CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("want *CodedError, got %T: %v", err, err)
	}
	if ce.Status != http.StatusBadRequest {
		t.Fatalf("field %q: status = %d, want 400 (a caller-correctable error, not a 500)", field, ce.Status)
	}
	if ce.Field != field {
		t.Fatalf("error field = %q, want %q", ce.Field, field)
	}
}

func TestCreateOffer_MalformedListingID_Is400(t *testing.T) {
	svc := NewService(nil, nil, nil)
	_, err := svc.CreateOffer(context.Background(), "buyer", "not-a-uuid", 1000, "hi")
	assertFieldErr(t, err, "listing_id")
}

func TestListOffersForListing_MalformedListingID_Is400(t *testing.T) {
	svc := NewService(nil, nil, nil)
	_, err := svc.ListOffersForListing(context.Background(), "buyer", "not-a-uuid")
	assertFieldErr(t, err, "listing_id")
}

func TestStartOrGetThread_MalformedListingID_Is400(t *testing.T) {
	svc := NewService(nil, nil, nil)
	_, err := svc.StartOrGetThread(context.Background(), "buyer", "not-a-uuid", "hello")
	assertFieldErr(t, err, "listing_id")
}

func TestPurchaseBoost_AbsentOrMalformedListingID_Is400(t *testing.T) {
	svc := NewService(nil, nil, nil)
	// An absent listing_id would reach GetListing's uuid compare as "" and 500
	// on the pg driver's empty-string cast — it must be a named field error.
	_, err := svc.PurchaseBoost(context.Background(), "seller", "idem-1", CreateBoostInput{ListingID: "", Tier: "vip"})
	assertFieldErr(t, err, "listing_id")
	_, err = svc.PurchaseBoost(context.Background(), "seller", "idem-2", CreateBoostInput{ListingID: "not-a-uuid", Tier: "vip"})
	assertFieldErr(t, err, "listing_id")
}

func TestBlockUser_MalformedBlockedUserID_Is400(t *testing.T) {
	svc := NewService(nil, nil, nil)
	_, err := svc.BlockUser(context.Background(), "user", "not-a-uuid")
	assertFieldErr(t, err, "blocked_user_id")
}

func TestSearchFallback_MalformedCategoryID_Is400(t *testing.T) {
	// The fallback casts category_id to ::uuid inside its recursive CTE — the
	// one place a query-param id could still reach Postgres unguarded.
	svc := NewService(nil, nil, nil)
	_, err := svc.Search(context.Background(), map[string]any{"category_id": "not-a-uuid"})
	assertFieldErr(t, err, "category_id")
}

func TestReviewKYC_OutOfVocabGrantTier_Is400(t *testing.T) {
	// grant_tier lands in mkt_user_moderation.kyc_tier (CHECK) and
	// mkt_trust_scores.kyc_tier (the kyc_tier SQL enum) — an out-of-vocab
	// string was a raw constraint/enum error → 500.
	svc := NewService(nil, nil, nil)
	bad := "tier99_god"
	_, err := svc.ReviewKYC(context.Background(), "admin", "admin", "user", KycReviewInput{
		Decision: "approve", ReasonCode: "docs_verified", GrantTier: &bad,
	})
	assertFieldErr(t, err, "grant_tier")
}

func TestValidateCategoryBody_ParentIDShape(t *testing.T) {
	malformed := "not-a-uuid"
	if err := validateCategoryBody(categoryBody{Slug: "s", Name: "n", ParentID: &malformed}); err == nil {
		t.Fatal("malformed parent_id must be refused before it reaches the uuid column")
	} else {
		assertFieldErr(t, err, "parent_id")
	}
	// A blank parent means "top-level" — toCategory must normalize it to NULL
	// rather than handing the uuid column an empty string.
	blank := "  "
	c := (categoryBody{Slug: "s", Name: "n", ParentID: &blank}).toCategory("NG")
	if c.ParentID != nil {
		t.Fatalf("blank parent_id should normalize to nil, got %q", *c.ParentID)
	}
	if err := validateCategoryBody(categoryBody{Slug: "s", Name: "n", ParentID: &blank}); err != nil {
		t.Fatalf("blank parent_id must pass validation (it means 'no parent'): %v", err)
	}
}

func TestAdminListBoosts_OutOfVocabStatus_Is400(t *testing.T) {
	// mkt_boosts.status is the boost_status SQL ENUM — an out-of-vocab
	// ?status= filter was a raw "invalid input value for enum" → 500. The
	// handler must whitelist it. 'cancelled_by_seller' is a Go-side display
	// status, not a stored enum value, so it must also be refused.
	gin.SetMode(gin.TestMode)
	h := NewHandler(&Service{})
	for _, status := range []string{"bogus", "cancelled_by_seller"} {
		r := gin.New()
		r.GET("/admin/boosts", h.AdminListBoosts)
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/admin/boosts?status="+status, nil)
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status=%q: got %d, want 400 (body %s)", status, rec.Code, rec.Body.String())
		}
	}
}
