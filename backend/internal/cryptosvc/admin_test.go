package cryptosvc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
// /api/v1/admin/crypto/swaps (a static sibling of /swaps/review) and must not let its own
// GET /swaps/review and POST /swaps/:id/resolve conflict. This guards against a Gin
// route-tree panic at server boot, which the per-package handler tests would miss.
func TestAdminReviewRouteDoesNotCollideWithLegacySwaps(t *testing.T) {
	s := newSvcRig(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	legacy := r.Group("/api/v1/admin/crypto")
	legacy.GET("/swaps", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"legacy": true}) })
	RegisterAdminRoutes(r.Group("/api/v1/admin/crypto"), HandlerDeps{Service: s.svc})

	for _, tc := range []struct{ method, path, key string }{
		{http.MethodGet, "/api/v1/admin/crypto/swaps", "legacy"},
		{http.MethodGet, "/api/v1/admin/crypto/swaps/review", "success"},
		// POST resolve with a bad id still routes to our handler (404 swap_not_found), proving the
		// route exists and does not collide with the GET siblings.
		{http.MethodPost, "/api/v1/admin/crypto/swaps/not-a-uuid/resolve", "error"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if _, ok := body[tc.key]; !ok {
			t.Fatalf("%s %s routed to the wrong handler: %v", tc.method, tc.path, body)
		}
	}
}

// ---- resolve (round 2) ----

// parkRealSwap drives a real swap into needs_review with the NGN hold live on the clearing
// account and no provider swap id — the ambiguous-outcome path. Returns the swap id.
func parkRealSwap(t *testing.T, r *svcRig) string {
	t.Helper()
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 503}
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); err == nil {
		t.Fatal("ambiguous outcome reported as success")
	}
	if r.led.bal(clearK) != 1_007_500 {
		t.Fatalf("hold not on clearing: %d", r.led.bal(clearK))
	}
	rec, _, _ := r.store.SwapByIDAny(context.Background(), q.ID)
	if rec.State != cryptoprov.SwapStateNeedsReview || rec.ProviderSwapID != "" {
		t.Fatalf("not parked without provider id: state=%s provider=%q", rec.State, rec.ProviderSwapID)
	}
	return q.ID
}

func TestAdminResolveReleaseReversesHoldAndFailsSwap(t *testing.T) {
	r := newSvcRig(t)
	sink := &auditSink{}
	r.svc.cfg.Audit = sink
	id := parkRealSwap(t, r)

	out, err := r.svc.AdminResolve(context.Background(), "admin:op-1", "idem-k", id, DecisionRelease, "provider never executed")
	if err != nil {
		t.Fatalf("release err = %v", err)
	}
	if r.led.bal(walletK) != 2_000_000 || r.led.bal(clearK) != 0 {
		t.Fatalf("hold not reversed to wallet: wallet=%d clearing=%d", r.led.bal(walletK), r.led.bal(clearK))
	}
	if out.State != cryptoprov.SwapStateFailed {
		t.Fatalf("state = %s, want failed", out.State)
	}
	if !sink.has("crypto.swap.admin_release") {
		t.Fatalf("no admin_release audit event: %v", sink.actions())
	}
}

func TestAdminResolveReleaseCannotDoubleCredit(t *testing.T) {
	r := newSvcRig(t)
	id := parkRealSwap(t, r)
	if _, err := r.svc.AdminResolve(context.Background(), "admin:op-1", "idem-k", id, DecisionRelease, "release"); err != nil {
		t.Fatalf("first release err = %v", err)
	}
	// The swap is now failed, so a second release is rejected as not-parked — the wallet is
	// never credited twice.
	if _, err := r.svc.AdminResolve(context.Background(), "admin:op-1", "idem-k", id, DecisionRelease, "release again"); !errors.Is(err, ErrNotParked) {
		t.Fatalf("second release err = %v, want ErrNotParked", err)
	}
	if r.led.bal(walletK) != 2_000_000 {
		t.Fatalf("wallet credited twice: %d", r.led.bal(walletK))
	}
}

func TestAdminResolveReleaseRefusedWhenProviderIDPresent(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	r.store.addSwap(SwapRecord{
		ID: "55555555-5555-5555-5555-555555555555", UserID: user, Provider: "mock",
		ProviderSwapID: "qdx_executed", State: cryptoprov.SwapStateNeedsReview, Side: SideBuy,
		ToCurrency: "USDT", NGNKobo: 1_000_000, FeeKobo: 7_500,
	})
	_, err := r.svc.AdminResolve(context.Background(), "admin:op", "idem-k", "55555555-5555-5555-5555-555555555555", DecisionRelease, "try to release")
	if !errors.Is(err, ErrReleaseUnsafe) {
		t.Fatalf("err = %v, want ErrReleaseUnsafe", err)
	}
	if r.led.bal(walletK) != 2_000_000 {
		t.Fatalf("a refused release still moved money: %d", r.led.bal(walletK))
	}
}

func TestAdminResolveRetryRequiresProviderID(t *testing.T) {
	r := newSvcRig(t)
	id := parkRealSwap(t, r) // parked with NO provider id
	_, err := r.svc.AdminResolve(context.Background(), "admin:op", "idem-k", id, DecisionRetry, "poll provider")
	if !errors.Is(err, ErrNothingToRetry) {
		t.Fatalf("err = %v, want ErrNothingToRetry", err)
	}
}

func TestAdminResolveRetryDelegatesToProvider(t *testing.T) {
	r := newSvcRig(t)
	r.store.addSwap(SwapRecord{
		ID: "66666666-6666-6666-6666-666666666666", UserID: user, Provider: "mock",
		ProviderSwapID: "unknown-to-mock", State: cryptoprov.SwapStateNeedsReview, Side: SideBuy,
		ToCurrency: "USDT", NGNKobo: 1_000_000, FeeKobo: 7_500,
	})
	// The mock has no such provider swap, so the re-poll errors — but through the provider, not
	// a guard. That proves retry delegated to ResolveSwap rather than short-circuiting.
	_, err := r.svc.AdminResolve(context.Background(), "admin:op", "idem-k", "66666666-6666-6666-6666-666666666666", DecisionRetry, "poll")
	if err == nil || errors.Is(err, ErrNothingToRetry) || errors.Is(err, ErrReleaseUnsafe) {
		t.Fatalf("retry did not delegate to the provider: err = %v", err)
	}
	rec, _, _ := r.store.SwapByIDAny(context.Background(), "66666666-6666-6666-6666-666666666666")
	if rec.State != cryptoprov.SwapStateNeedsReview {
		t.Fatalf("a failed re-poll changed state to %s", rec.State)
	}
}

func TestAdminResolveNotFoundAndNotParked(t *testing.T) {
	r := newSvcRig(t)
	if _, err := r.svc.AdminResolve(context.Background(), "admin:op", "idem-k", "77777777-7777-7777-7777-777777777777", DecisionRelease, "n"); !errors.Is(err, ErrSwapNotFound) {
		t.Fatalf("unknown id err = %v, want ErrSwapNotFound", err)
	}
	r.store.addSwap(SwapRecord{ID: "88888888-8888-8888-8888-888888888888", UserID: user, State: cryptoprov.SwapStateCompleted, Side: SideBuy, ToCurrency: "BTC", NGNKobo: 1})
	if _, err := r.svc.AdminResolve(context.Background(), "admin:op", "idem-k", "88888888-8888-8888-8888-888888888888", DecisionRelease, "n"); !errors.Is(err, ErrNotParked) {
		t.Fatalf("completed swap err = %v, want ErrNotParked", err)
	}
}

func adminHTTPRig(t *testing.T, s *svcRig, actor string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	grp := r.Group("/api/v1/admin/crypto")
	grp.Use(func(c *gin.Context) {
		if actor != "" {
			c.Set("user_id", actor)
		}
		c.Next()
	})
	RegisterAdminRoutes(grp, HandlerDeps{Service: s.svc})
	return r
}

func postResolve(t *testing.T, r *gin.Engine, id string, body any, hdr map[string]string) (int, map[string]any) {
	t.Helper()
	var buf []byte
	if body != nil {
		buf, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/crypto/swaps/"+id+"/resolve", bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestResolveHTTPValidation(t *testing.T) {
	s := newSvcRig(t)
	r := adminHTTPRig(t, s, "op-1")
	id := "99999999-9999-9999-9999-999999999999"
	idem := map[string]string{"Idempotency-Key": "k-1"}

	// Malformed id is a plain 404 before anything else.
	if code, b := postResolve(t, r, "not-a-uuid", map[string]any{"decision": "release", "note": "x"}, idem); code != http.StatusNotFound || b["error"] != "swap_not_found" {
		t.Fatalf("malformed id -> %d %v", code, b)
	}
	// Missing Idempotency-Key is rejected (iron rule: money mutation needs one).
	if code, b := postResolve(t, r, id, map[string]any{"decision": "release", "note": "x"}, nil); code != http.StatusBadRequest || b["error"] != "idempotency_key_required" {
		t.Fatalf("missing idem -> %d %v", code, b)
	}
	// Missing note is rejected (audit trail).
	if code, b := postResolve(t, r, id, map[string]any{"decision": "release", "note": "  "}, idem); code != http.StatusBadRequest || b["error"] != "note_required" {
		t.Fatalf("missing note -> %d %v", code, b)
	}
	// Unknown decision is rejected.
	if code, b := postResolve(t, r, id, map[string]any{"decision": "settle", "note": "x"}, idem); code != http.StatusBadRequest || b["error"] != "bad_decision" {
		t.Fatalf("bad decision -> %d %v", code, b)
	}
}

func TestResolveHTTPReleaseHappyPath(t *testing.T) {
	s := newSvcRig(t)
	id := parkRealSwap(t, s)
	r := adminHTTPRig(t, s, "op-1")
	code, b := postResolve(t, r, id, map[string]any{"decision": "release", "note": "provider never executed"}, map[string]string{"Idempotency-Key": "k-1"})
	if code != http.StatusOK || b["success"] != true {
		t.Fatalf("release -> %d %v", code, b)
	}
	sw := b["swap"].(map[string]any)
	if sw["status"] != "failed" {
		t.Fatalf("status = %v, want failed", sw["status"])
	}
	if s.led.bal(walletK) != 2_000_000 {
		t.Fatalf("hold not reversed: wallet=%d", s.led.bal(walletK))
	}
}

func TestResolveHTTPReleaseUnsafe(t *testing.T) {
	s := newSvcRig(t)
	s.store.addSwap(SwapRecord{
		ID: "aaaa1111-2222-3333-4444-555566667777", UserID: user, Provider: "mock",
		ProviderSwapID: "qdx_executed", State: cryptoprov.SwapStateNeedsReview, Side: SideBuy,
		ToCurrency: "USDT", NGNKobo: 1_000_000, FeeKobo: 7_500,
	})
	r := adminHTTPRig(t, s, "op-1")
	code, b := postResolve(t, r, "aaaa1111-2222-3333-4444-555566667777", map[string]any{"decision": "release", "note": "x"}, map[string]string{"Idempotency-Key": "k-1"})
	if code != http.StatusUnprocessableEntity || b["error"] != "release_unsafe" {
		t.Fatalf("release_unsafe -> %d %v", code, b)
	}
}
