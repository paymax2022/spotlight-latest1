package connectverification

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func ptr(s string) *string { return &s }

func TestMapReviewState(t *testing.T) {
	for status, want := range map[string]string{
		"pending": "pending", "l0_passed": "approved", "l1_passed": "approved", "approved": "approved",
		"failed": "rejected", "rejected": "rejected", "expired": "resubmit",
	} {
		if got := mapReviewState(status); got != want {
			t.Errorf("%s -> %s, want %s", status, got, want)
		}
	}
	// 'none' is not a submission and never appears in the queue.
	if got := mapReviewState("none"); got != "" {
		t.Errorf("none -> %q, want empty (excluded)", got)
	}
	if got := mapReviewState("something_new"); got != "" {
		t.Errorf("unknown status must be excluded, got %q", got)
	}
}

func TestMapReviewRowMasksAndNeverExposesInternals(t *testing.T) {
	created := time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)
	r := reviewRow{
		ID: "11111111-1111-4111-8111-111111111111", UserID: "22222222-2222-4222-8222-222222222222",
		Handle: ptr("ada"), Level: "l1", DocType: ptr("NIN"), DocHash: ptr("deadbeefcafe0123456789abcdef0123456789abcdef0123456789abcdef9f3a"),
		Status: "l1_passed", CreatedAt: created,
	}
	got, ok := mapReviewRow(r)
	if !ok {
		t.Fatal("row excluded")
	}
	if got.Handle != "ada" || got.DocType != "nin" || got.BadgeTarget != "nin" || got.State != "approved" {
		t.Fatalf("got %+v", got)
	}
	if got.DocRefMasked != "NIN ••••9f3a" {
		t.Fatalf("mask = %q", got.DocRefMasked)
	}
	raw, _ := json.Marshal(got)
	for _, leak := range []string{"deadbeef", "doc_hash", "evidence_ref", "cafe0123"} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("response leaks %q: %s", leak, raw)
		}
	}
	if got.LivenessScore != nil {
		t.Error("liveness is not stored; it must be null, never fabricated")
	}
}

func TestMapReviewRowDefaults(t *testing.T) {
	r := reviewRow{ID: "a", UserID: "bbbbbbbb-1111-4111-8111-111111111111", Level: "l0", Status: "pending", CreatedAt: time.Now()}
	got, ok := mapReviewRow(r)
	if !ok || got.DocType != "selfie_liveness" || got.BadgeTarget != "selfie" || got.DocRefMasked != "SELFIE ••••" {
		t.Fatalf("selfie row = %+v ok=%v", got, ok)
	}
	if got.Handle != "user bbbbbbbb" {
		t.Fatalf("handle fallback = %q", got.Handle)
	}
	for in, want := range map[string]string{"passport": "passport", "Drivers License": "drivers_license", "BVN": "bvn", "weird": "national_id"} {
		g, _ := mapReviewRow(reviewRow{ID: "a", UserID: "u", DocType: ptr(in), Status: "pending", Level: "l1"})
		if g.DocType != want {
			t.Errorf("doc type %q -> %q, want %q", in, g.DocType, want)
		}
	}
	if g, _ := mapReviewRow(reviewRow{ID: "a", UserID: "u", DocType: ptr("passport"), Status: "pending", Level: "l2"}); g.BadgeTarget != "id" {
		t.Errorf("passport badge = %q", g.BadgeTarget)
	}
	if g, _ := mapReviewRow(reviewRow{ID: "a", UserID: "u", Status: "pending", Level: "l3"}); g.BadgeTarget != "full" {
		t.Errorf("l3 badge = %q", g.BadgeTarget)
	}
	if _, ok := mapReviewRow(reviewRow{ID: "a", UserID: "u", Status: "none", Level: "l0"}); ok {
		t.Error("a 'none' row must be excluded")
	}
}

func TestParseReviewState(t *testing.T) {
	for in, wantOK := range map[string]bool{"": true, "all": true, "pending": true, "in_review": true, "approved": true, "rejected": true, "resubmit": true, "bogus": false, "PENDING": false, "pending;drop": false} {
		if _, ok := parseReviewState(in); ok != wantOK {
			t.Errorf("%q ok=%v want %v", in, ok, wantOK)
		}
	}
}

func TestParseReviewLimit(t *testing.T) {
	for in, want := range map[string]int{"": 100, "abc": 100, "-5": 100, "0": 100, "50": 50, "500": 200, "200": 200} {
		if got := parseReviewLimit(in); got != want {
			t.Errorf("%q -> %d, want %d", in, got, want)
		}
	}
}

func TestReviewHandlerRejectsABadStateBeforeTouchingTheDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	q := &ReviewQueue{} // nil pool: any query attempt would panic
	r := gin.New()
	r.GET("/identity", q.Handler)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/identity?state=bogus", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d", w.Code)
	}
}

// Review: the mask suffix is derived only from a well-formed HMAC-SHA256 hex digest (64 hex chars);
// anything else (legacy or malformed values) yields no suffix at all.
func TestMaskRefOnlyUsesAWellFormedHMAC(t *testing.T) {
	good := strings.Repeat("a", 60) + "9f3a"
	if got := maskRef("nin", &good); got != "NIN ••••9f3a" {
		t.Fatalf("good hash -> %q", got)
	}
	for name, h := range map[string]string{
		"short hex":   "abcd9f3a",
		"plaintext":   "1234567890123456",
		"non-hex":     strings.Repeat("z", 64),
		"63 chars":    strings.Repeat("a", 63),
		"65 chars":    strings.Repeat("a", 65),
		"empty":       "",
		"hex-looking": "0123456789",
	} {
		h := h
		if got := maskRef("nin", &h); got != "NIN ••••" {
			t.Errorf("%s -> %q: a malformed value must yield no suffix", name, got)
		}
	}
}

func TestTrimToLimitReportsHasMore(t *testing.T) {
	rows := []IdentityReview{{ID: "1"}, {ID: "2"}, {ID: "3"}}
	got, more := trimToLimit(rows, 2)
	if len(got) != 2 || !more {
		t.Fatalf("got %d more=%v", len(got), more)
	}
	got, more = trimToLimit(rows, 3)
	if len(got) != 3 || more {
		t.Fatalf("exact fit: got %d more=%v", len(got), more)
	}
	got, more = trimToLimit(nil, 5)
	if got == nil || len(got) != 0 || more {
		t.Fatalf("empty must be a non-nil empty slice, got %v more=%v", got, more)
	}
}
