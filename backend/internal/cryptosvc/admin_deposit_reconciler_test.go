package cryptosvc

// The admin status view for the money-IN safety net (GAP-DEP-01 Slice 2b): a compact read of
// what the deposit sweep has done, gated to 503 when no deposit reconciler was wired. Counts
// and alert text only — no sub-account identifier leaks.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"github.com/gin-gonic/gin"
)

func depositReconRig(t *testing.T, withRec bool) (*gin.Engine, *DepositReconciler) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	d := HandlerDeps{}
	if withRec {
		reg, mock := newMockRegistry("quidax")
		mock.AddDeposit(confirmedDeposit("acct-secret", "dep-secret", decimal.RequireFromString("0.5")))
		rec := NewDepositReconciler(DepositReconcilerConfig{
			ProviderName: "quidax", Registry: reg,
			Settler:  &recordingSettler{outcome: OutcomeApplied},
			Accounts: fakeAccounts{byProvider: map[string][]string{"quidax": {"acct-secret"}}},
			Leader:   fakeLeader{lead: true},
			Alert:    func(string, string) {},
		})
		if _, err := rec.RunOnce(t.Context()); err != nil {
			t.Fatalf("RunOnce: %v", err)
		}
		d.DepositRecon = rec
	}
	h := &adminHandler{d: d, now: func() time.Time { return time.Unix(0, 0).UTC() }}
	e := gin.New()
	e.Group("/api/v1/admin/crypto").GET("/deposits/reconciler", h.depositReconcilerStatus)
	return e, d.DepositRecon
}

func TestDepositReconcilerStatusReportsCounts(t *testing.T) {
	e, _ := depositReconRig(t, true)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/deposits/reconciler", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v", err)
	}
	replica := body["replica"].(map[string]any)
	if replica["runs"].(float64) != 1 || replica["led_runs"].(float64) != 1 {
		t.Fatalf("replica block wrong: %v", replica)
	}
	lr := replica["last_result"].(map[string]any)
	if lr["settled"].(float64) != 1 || lr["scanned"].(float64) != 1 || lr["accounts"].(float64) != 1 {
		t.Fatalf("last_result wrong: %v", lr)
	}
}

func TestDepositReconcilerStatusIs503WhenNotWired(t *testing.T) {
	e, _ := depositReconRig(t, false)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/deposits/reconciler", nil))
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), "deposit_reconciler_not_running") {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestDepositReconcilerStatusDoesNotLeakAccountIDs(t *testing.T) {
	e, _ := depositReconRig(t, true)
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/crypto/deposits/reconciler", nil))
	for _, s := range []string{"acct-secret", "dep-secret"} {
		if strings.Contains(w.Body.String(), s) {
			t.Fatalf("telemetry leaked %q: %s", s, w.Body.String())
		}
	}
}
