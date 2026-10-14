package cryptosvc

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/cryptoprov"
)

// adminReviewRig mounts just the read-only review queue on a bare engine with a fixed clock,
// so age assertions are deterministic. RBAC is applied at the mount site (finance_routes),
// not in the handler, so there is nothing auth-related to stub here.
func adminReviewRig(t *testing.T) (*svcRig, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s := newSvcRig(t)
	r := gin.New()
	h := &adminHandler{d: HandlerDeps{Service: s.svc}, now: func() time.Time { return s.now }}
	r.Group("/api/v1/admin/crypto").GET("/swaps/review", h.reviewQueue)
	return s, r
}

func seedReview(s *svcRig, id, uid, asset string, ngn, fee int64, providerSwapID string, parkedAgo time.Duration) {
	s.store.addSwap(SwapRecord{
		ID: id, UserID: uid, Provider: "mock", ProviderSwapID: providerSwapID,
		State: cryptoprov.SwapStateNeedsReview, Side: SideBuy, ToCurrency: asset,
		NGNKobo: ngn, FeeKobo: fee, UpdatedAt: s.now.Add(-parkedAgo),
	})
}

func getReview(t *testing.T, r *gin.Engine, query string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/swaps/review"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return w.Code, body
}

func swapsOf(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()
	raw, ok := body["swaps"].([]any)
	if !ok {
		t.Fatalf("no swaps array in %v", body)
	}
	out := make([]map[string]any, 0, len(raw))
	for _, x := range raw {
		out = append(out, x.(map[string]any))
	}
	return out
}

func TestReviewQueueListsOnlyNeedsReviewWithHeldMoney(t *testing.T) {
	s, r := adminReviewRig(t)
	seedReview(s, "11111111-1111-1111-1111-111111111111", "user-a", "USDT", 1_000_000, 7_500, "qdx_1", 2*time.Hour)
	// A completed swap and a confirming one must never show up in the review queue.
	s.store.addSwap(SwapRecord{ID: "22222222-2222-2222-2222-222222222222", UserID: "user-b", State: cryptoprov.SwapStateCompleted, Side: SideBuy, ToCurrency: "BTC", NGNKobo: 5_000_000, UpdatedAt: s.now})
	s.store.addSwap(SwapRecord{ID: "33333333-3333-3333-3333-333333333333", UserID: "user-c", State: cryptoprov.SwapStateConfirming, Side: SideBuy, ToCurrency: "ETH", NGNKobo: 9_000_000, UpdatedAt: s.now})

	code, body := getReview(t, r, "")
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if body["success"] != true {
		t.Fatalf("success = %v", body["success"])
	}
	if body["count"].(float64) != 1 {
		t.Fatalf("count = %v, want 1", body["count"])
	}
	sw := swapsOf(t, body)
	if len(sw) != 1 {
		t.Fatalf("got %d swaps, want 1", len(sw))
	}
	got := sw[0]
	if got["id"] != "11111111-1111-1111-1111-111111111111" || got["user_id"] != "user-a" {
		t.Fatalf("wrong swap surfaced: %v", got)
	}
	if got["status"] != "needs_review" || got["asset"] != "USDT" {
		t.Fatalf("status/asset = %v/%v", got["status"], got["asset"])
	}
	if got["ngn_kobo"].(float64) != 1_000_000 || got["fee_kobo"].(float64) != 7_500 {
		t.Fatalf("kobo fields wrong: %v", got)
	}
	if got["held_kobo"].(float64) != 1_007_500 {
		t.Fatalf("held_kobo = %v, want 1007500 (ngn+fee)", got["held_kobo"])
	}
	if got["has_provider_id"] != true || got["provider_swap_id"] != "qdx_1" {
		t.Fatalf("provider id fields wrong: %v", got)
	}
	if got["age_seconds"].(float64) != 7200 {
		t.Fatalf("age_seconds = %v, want 7200 (2h)", got["age_seconds"])
	}
}

func TestReviewQueueFlagsSwapsWithNoProviderID(t *testing.T) {
	s, r := adminReviewRig(t)
	// The dangerous case: parked with NO provider swap id — provider outcome unknown.
	seedReview(s, "44444444-4444-4444-4444-444444444444", "user-d", "BTC", 5_000_000, 37_500, "", time.Hour)
	_, body := getReview(t, r, "")
	got := swapsOf(t, body)[0]
	if got["has_provider_id"] != false {
		t.Fatalf("has_provider_id = %v, want false", got["has_provider_id"])
	}
	if _, present := got["provider_swap_id"]; present {
		t.Fatalf("provider_swap_id should be omitted when empty, got %v", got["provider_swap_id"])
	}
}

func TestReviewQueueOldestParkedFirst(t *testing.T) {
	s, r := adminReviewRig(t)
	seedReview(s, "aaaaaaaa-0000-0000-0000-000000000000", "user-new", "USDT", 100, 0, "p1", 10*time.Minute)
	seedReview(s, "bbbbbbbb-0000-0000-0000-000000000000", "user-old", "USDT", 100, 0, "p2", 5*time.Hour)
	_, body := getReview(t, r, "")
	sw := swapsOf(t, body)
	if len(sw) != 2 || sw[0]["user_id"] != "user-old" || sw[1]["user_id"] != "user-new" {
		t.Fatalf("not oldest-parked-first: %v", sw)
	}
}

func TestReviewQueuePaginationBounds(t *testing.T) {
	s, r := adminReviewRig(t)
	for i := 0; i < 3; i++ {
		seedReview(s, string(rune('a'+i))+"0000000-0000-0000-0000-000000000000", "u", "USDT", 100, 0, "p", time.Duration(i)*time.Hour)
	}
	// limit clamps to >=1; an absurd value is capped, not honoured as a wide page.
	_, body := getReview(t, r, "?limit=1&offset=0")
	if body["count"].(float64) != 1 {
		t.Fatalf("limit=1 count = %v", body["count"])
	}
	_, body = getReview(t, r, "?limit=99999999")
	if body["count"].(float64) != 3 {
		t.Fatalf("huge limit should return all 3, got %v", body["count"])
	}
	_, body = getReview(t, r, "?offset=2")
	if body["count"].(float64) != 1 {
		t.Fatalf("offset=2 of 3 count = %v", body["count"])
	}
	// offset past the end is an empty page, not an error.
	code, body := getReview(t, r, "?offset=100")
	if code != http.StatusOK || body["count"].(float64) != 0 {
		t.Fatalf("offset past end: code=%d count=%v", code, body["count"])
	}
}

func TestReviewQueueEmpty(t *testing.T) {
	_, r := adminReviewRig(t)
	code, body := getReview(t, r, "")
	if code != http.StatusOK || body["count"].(float64) != 0 {
		t.Fatalf("empty queue: code=%d count=%v", code, body["count"])
	}
	if sw := swapsOf(t, body); len(sw) != 0 {
		t.Fatalf("expected empty swaps array, got %v", sw)
	}
}

// RegisterAdminRoutes must coexist on one engine with the legacy module's GET
// /api/v1/admin/crypto/swaps (a static sibling of /swaps/review). This guards against a
// Gin route-tree panic at server boot, which the per-package handler tests would miss.
func TestAdminReviewRouteDoesNotCollideWithLegacySwaps(t *testing.T) {
	s := newSvcRig(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	legacy := r.Group("/api/v1/admin/crypto")
	legacy.GET("/swaps", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"legacy": true}) })
	RegisterAdminRoutes(r.Group("/api/v1/admin/crypto"), HandlerDeps{Service: s.svc})

	for _, tc := range []struct{ path, key string }{
		{"/api/v1/admin/crypto/swaps", "legacy"},
		{"/api/v1/admin/crypto/swaps/review", "success"},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s -> %d", tc.path, w.Code)
		}
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if _, ok := body[tc.key]; !ok {
			t.Fatalf("GET %s routed to the wrong handler: %v", tc.path, body)
		}
	}
}
