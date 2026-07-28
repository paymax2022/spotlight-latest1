package symptomsearch

// HTTP-surface tests (httptest + gin over the in-memory fake repo — no DB):
// symptom-search happy path + contract 404, the per-user+device rate limiter
// (429 + headers, in-memory fallback path), and the admin safety-metrics
// endpoint shape (the exact contract the admin console builds against).

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// metricsFakeRepo layers a canned SafetyMetrics onto the fake repo so the
// service's metricsReader port resolves.
type metricsFakeRepo struct {
	*fakeRepo
	metrics *SafetyMetrics
	err     error
}

func (m *metricsFakeRepo) SafetyMetrics(_ context.Context) (*SafetyMetrics, error) {
	return m.metrics, m.err
}

func authAs(uid string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if uid != "" {
			c.Set("user_id", uid)
		}
		c.Next()
	}
}

func newSearchRouter(h *Handler, uid string, mw ...gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(authAs(uid))
	handlers := append(append([]gin.HandlerFunc{}, mw...), h.SymptomSearch)
	r.POST("/symptom-search", handlers...)
	return r
}

func doJSON(t *testing.T, r *gin.Engine, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ─── POST /symptom-search ────────────────────────────────────────────────────

func TestHTTP_SymptomSearch_HappyPath(t *testing.T) {
	svc, _ := newTestService()
	h := NewHandler(svc, nil)
	r := newSearchRouter(h, "user-1")

	w := doJSON(t, r, http.MethodPost, "/symptom-search",
		`{"terms":["fever"],"refiners":{"duration":"TODAY"}}`, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var body struct {
		Data struct {
			Tier                           string              `json:"tier"`
			ClassGroups                    []SymptomClassGroup `json:"class_groups"`
			PharmacistConfirmationRequired bool                `json:"pharmacist_confirmation_required"`
			Disclaimer                     string              `json:"disclaimer"`
			SearchEventID                  string              `json:"search_event_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if body.Data.Tier != "T2" {
		t.Fatalf("fever base tier = %s, want T2", body.Data.Tier)
	}
	if !body.Data.PharmacistConfirmationRequired {
		t.Fatal("T2 must carry pharmacist_confirmation_required=true")
	}
	if len(body.Data.ClassGroups) == 0 {
		t.Fatal("T2 must carry class groups")
	}
	if body.Data.Disclaimer == "" {
		t.Fatal("disclaimer copy must always be present")
	}
	if body.Data.SearchEventID == "" {
		t.Fatal("search_event_id must ride on the response for order linking")
	}
}

func TestHTTP_SymptomSearch_NoMatch404(t *testing.T) {
	svc, _ := newTestService()
	h := NewHandler(svc, nil)
	r := newSearchRouter(h, "user-1")
	w := doJSON(t, r, http.MethodPost, "/symptom-search", `{"terms":["xyzzy nonsense"]}`, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("no-match status = %d, want 404 (contract)", w.Code)
	}
}

func TestHTTP_SymptomSearch_Unauthenticated401(t *testing.T) {
	svc, _ := newTestService()
	h := NewHandler(svc, nil)
	r := newSearchRouter(h, "")
	w := doJSON(t, r, http.MethodPost, "/symptom-search", `{"terms":["fever"]}`, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

// ─── Rate limit (in-memory fallback path; the Redis path shares the header
//     and 429 plumbing and mirrors maps.redisAllow) ──────────────────────────

func TestHTTP_SymptomSearch_RateLimited429(t *testing.T) {
	svc, _ := newTestService()
	h := NewHandler(svc, nil)
	r := newSearchRouter(h, "user-1", PerUserDeviceRateLimit(nil, 2, time.Minute))

	hdr := map[string]string{"X-Device-Id": "device-A"}
	for i := 1; i <= 2; i++ {
		w := doJSON(t, r, http.MethodPost, "/symptom-search", `{"terms":["fever"]}`, hdr)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want 200", i, w.Code)
		}
	}
	w := doJSON(t, r, http.MethodPost, "/symptom-search", `{"terms":["fever"]}`, hdr)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("request 3: status = %d, want 429", w.Code)
	}
	if got := w.Header().Get("X-RateLimit-Limit"); got != "2" {
		t.Fatalf("X-RateLimit-Limit = %q, want 2", got)
	}
	if got := w.Header().Get("X-RateLimit-Remaining"); got != "0" {
		t.Fatalf("X-RateLimit-Remaining = %q, want 0", got)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "rate_limited" {
		t.Fatalf("429 body must carry code=rate_limited, got %v", body)
	}

	// A different device hash is a different bucket — same user still served.
	w = doJSON(t, r, http.MethodPost, "/symptom-search", `{"terms":["fever"]}`,
		map[string]string{"X-Device-Id": "device-B"})
	if w.Code != http.StatusOK {
		t.Fatalf("different device must have its own window, got %d", w.Code)
	}
}

// ─── GET /admin/symptom/metrics ──────────────────────────────────────────────

func TestHTTP_AdminSymptomMetrics_ExactShape(t *testing.T) {
	med := 421.5
	share := 0.25
	repo := &metricsFakeRepo{
		fakeRepo: newFakeRepo(),
		metrics: &SafetyMetrics{
			ByState:               map[string]int{"SUBMITTED": 3, "APPROVED": 5},
			ByTier:                map[string]int{"T2": 7},
			OpenOverdue:           2,
			MedianDecisionSeconds: &med,
			Searches24h:           41,
			GatedShare7d:          &share,
		},
	}
	h := NewHandler(NewService(repo, nil), nil)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(authAs("admin-1"))
	r.GET("/symptom/metrics", h.AdminSymptomMetrics)

	w := doJSON(t, r, http.MethodGet, "/symptom/metrics", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var body struct {
		Data struct {
			ByState               map[string]int `json:"by_state"`
			ByTier                map[string]int `json:"by_tier"`
			OpenOverdue           int            `json:"open_overdue"`
			MedianDecisionSeconds *float64       `json:"median_decision_seconds"`
			Searches24h           int            `json:"searches_24h"`
			GatedShare7d          *float64       `json:"gated_share_7d"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	// Zero-fill: every state and tier key is ALWAYS present (stable console shape).
	for _, st := range []string{"SUBMITTED", "AUTO_CLEARED", "PHARMACIST_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED"} {
		if _, ok := body.Data.ByState[st]; !ok {
			t.Fatalf("by_state missing key %s: %v", st, body.Data.ByState)
		}
	}
	for _, tier := range []string{"T1", "T2", "T3", "T4"} {
		if _, ok := body.Data.ByTier[tier]; !ok {
			t.Fatalf("by_tier missing key %s: %v", tier, body.Data.ByTier)
		}
	}
	if body.Data.ByState["SUBMITTED"] != 3 || body.Data.ByState["APPROVED"] != 5 || body.Data.ByState["REJECTED"] != 0 {
		t.Fatalf("by_state values wrong: %v", body.Data.ByState)
	}
	if body.Data.ByTier["T2"] != 7 || body.Data.ByTier["T1"] != 0 {
		t.Fatalf("by_tier values wrong: %v", body.Data.ByTier)
	}
	if body.Data.OpenOverdue != 2 || body.Data.Searches24h != 41 {
		t.Fatalf("open_overdue/searches_24h wrong: %+v", body.Data)
	}
	if body.Data.MedianDecisionSeconds == nil || *body.Data.MedianDecisionSeconds != 421.5 {
		t.Fatalf("median_decision_seconds wrong: %v", body.Data.MedianDecisionSeconds)
	}
	if body.Data.GatedShare7d == nil || *body.Data.GatedShare7d != 0.25 {
		t.Fatalf("gated_share_7d wrong: %v", body.Data.GatedShare7d)
	}
}

func TestHTTP_AdminSymptomMetrics_NullableKPIsSerialiseAsNull(t *testing.T) {
	repo := &metricsFakeRepo{fakeRepo: newFakeRepo(), metrics: &SafetyMetrics{}}
	h := NewHandler(NewService(repo, nil), nil)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(authAs("admin-1"))
	r.GET("/symptom/metrics", h.AdminSymptomMetrics)

	w := doJSON(t, r, http.MethodGet, "/symptom/metrics", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	raw := w.Body.String()
	// The contract requires the keys to be PRESENT with null values — never absent.
	if !strings.Contains(raw, `"median_decision_seconds":null`) {
		t.Fatalf("median_decision_seconds must serialise as explicit null, got %s", raw)
	}
	if !strings.Contains(raw, `"gated_share_7d":null`) {
		t.Fatalf("gated_share_7d must serialise as explicit null, got %s", raw)
	}
}

func TestHTTP_AdminSymptomMetrics_Unauthenticated401(t *testing.T) {
	repo := &metricsFakeRepo{fakeRepo: newFakeRepo(), metrics: &SafetyMetrics{}}
	h := NewHandler(NewService(repo, nil), nil)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/symptom/metrics", h.AdminSymptomMetrics)
	w := doJSON(t, r, http.MethodGet, "/symptom/metrics", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

// A repo without the metrics port maps to the 404 branch — never a 500.
func TestHTTP_AdminSymptomMetrics_PortAbsent404(t *testing.T) {
	h := NewHandler(NewService(newFakeRepo(), nil), nil)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(authAs("admin-1"))
	r.GET("/symptom/metrics", h.AdminSymptomMetrics)
	w := doJSON(t, r, http.MethodGet, "/symptom/metrics", "", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}
