package cryptosvc

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/cryptoprov"
)

func reconcilerRig(t *testing.T, withRecon bool) (*reconRig, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rr := newReconRig(t)
	d := HandlerDeps{Service: rr.svc}
	if withRecon {
		d.Recon = rr.rec
	}
	h := &adminHandler{d: d, now: func() time.Time { return rr.now }}
	e := gin.New()
	e.Group("/api/v1/admin/crypto").GET("/reconciler", h.reconcilerStatus)
	return rr, e
}

func getReconciler(t *testing.T, e *gin.Engine) (int, map[string]any) {
	t.Helper()
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/reconciler", nil))
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return w.Code, body
}

func TestReconcilerStatusReportsReplicaStateAndBacklog(t *testing.T) {
	rr, e := reconcilerRig(t, true)
	rr.store.addSwap(SwapRecord{ID: "p1", UserID: user, State: cryptoprov.SwapStateNeedsReview, Side: SideBuy,
		ToCurrency: "USDT", NGNKobo: 1_000_000, FeeKobo: 7_500, UpdatedAt: rr.now.Add(-5 * time.Minute)})
	rr.rec.alert("clearing_negative", "crypto_clearing balance is -5 kobo")
	rr.run(t)

	code, body := getReconciler(t, e)
	if code != http.StatusOK {
		t.Fatalf("status %d: %v", code, body)
	}
	replica := body["replica"].(map[string]any)
	if replica["runs"].(float64) != 1 || replica["led_runs"].(float64) != 1 || replica["last_led"] != true {
		t.Fatalf("replica block wrong: %v", replica)
	}
	alerts := replica["recent_alerts"].([]any)
	if len(alerts) != 1 || alerts[0].(map[string]any)["kind"] != "clearing_negative" {
		t.Fatalf("alerts wrong: %v", alerts)
	}
	var nr map[string]any
	for _, b := range body["backlog"].([]any) {
		if m := b.(map[string]any); m["state"] == "needs_review" {
			nr = m
		}
	}
	if nr == nil || nr["count"].(float64) != 1 || nr["held_kobo"].(float64) != 1_007_500 || nr["oldest_age_seconds"].(float64) != 300 {
		t.Fatalf("needs_review backlog wrong: %v", nr)
	}
	if note, _ := body["note"].(string); note == "" {
		t.Fatal("the per-replica caveat must be stated in the response")
	}
}

func TestReconcilerStatusIs503WhenNoReconcilerRuns(t *testing.T) {
	_, e := reconcilerRig(t, false)
	code, body := getReconciler(t, e)
	if code != http.StatusServiceUnavailable || body["error"] != "reconciler_not_running" {
		t.Fatalf("status %d body %v", code, body)
	}
}

// A telemetry read must not expose anything a member view hides from other users or mutate swaps.
func TestReconcilerStatusDoesNotLeakSwapDetails(t *testing.T) {
	rr, e := reconcilerRig(t, true)
	rr.store.addSwap(SwapRecord{ID: "secret-swap-id", UserID: "secret-user", Provider: "mock", ProviderSwapID: "prov-secret",
		State: cryptoprov.SwapStateNeedsReview, Side: SideBuy, ToCurrency: "USDT", NGNKobo: 1, UpdatedAt: rr.now})
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/reconciler", nil))
	for _, s := range []string{"secret-swap-id", "secret-user", "prov-secret"} {
		if strings.Contains(w.Body.String(), s) {
			t.Fatalf("telemetry leaked %q: %s", s, w.Body.String())
		}
	}
}
