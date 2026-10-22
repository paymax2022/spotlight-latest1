package cryptosvc

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

type memAuditLog struct {
	rows []AuditRow
	q    AuditQuery
	err  error
}

func (m *memAuditLog) Search(_ context.Context, q AuditQuery) ([]AuditRow, error) {
	m.q = q
	return m.rows, m.err
}

// healthProv adds recorded telemetry to the mock.
type healthProv struct {
	*spy
	h cryptoprov.Health
}

func (p healthProv) Health(time.Time) cryptoprov.Health { return p.h }

func adminOpsRig(t *testing.T) (*httpRig, *memAuditLog, *memDeposits) {
	t.Helper()
	h := newHTTPRig(t, "admin-1")
	al := &memAuditLog{}
	ds := newMemDeposits(h.store)
	h.svc.cfg.Deposits = ds
	admin := h.r.Group("/api/v1/admin/crypto", func(c *gin.Context) { c.Set("user_id", "admin-1"); c.Next() })
	RegisterAdminRoutes(admin, HandlerDeps{Service: h.svc, Ingest: h.svc.cfg.Ingest, AuditLog: al})
	return h, al, ds
}

func TestProviderHealthReportsTelemetryAndAStatus(t *testing.T) {
	h, _, _ := adminOpsRig(t)
	now := time.Now()
	reg := cryptoprov.NewRegistry("mock")
	_ = reg.Register(healthProv{spy: h.prov, h: cryptoprov.Health{Window: 15 * time.Minute, Calls: 100, Failures: 1, Throttled: 3,
		P50: 120 * time.Millisecond, P95: 900 * time.Millisecond, LastSuccessAt: now, LastFailure: "GET /x -> 429", LastFailureAt: now}})
	h.svc.cfg.Registry = reg
	h.store.lastWebhook = now.Add(-2 * time.Minute)

	w := h.do("GET", "/api/v1/admin/crypto/provider-health", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	b := decode(t, w)["health"].(map[string]any)
	if b["calls"] != float64(100) || b["throttled"] != float64(3) || b["p95_ms"] != float64(900) || b["status"] != "degraded" {
		t.Fatalf("health = %v", b)
	}
	if lag := b["webhook_lag_seconds"].(float64); lag < 110 || lag > 200 {
		t.Fatalf("webhook lag = %v", lag)
	}
}

func TestProviderHealthStatusRules(t *testing.T) {
	for want, hl := range map[string]cryptoprov.Health{
		"idle":     {},
		"ok":       {Calls: 50, P95: 300 * time.Millisecond},
		"degraded": {Calls: 50, Failures: 4, P95: 300 * time.Millisecond},
		"down":     {Calls: 10, Failures: 6},
	} {
		if got := healthStatus(hl); got != want {
			t.Errorf("%+v -> %s, want %s", hl, got, want)
		}
	}
}

func TestAuditSearchPassesBoundedFilters(t *testing.T) {
	h, al, _ := adminOpsRig(t)
	al.rows = []AuditRow{{ID: "a1", Actor: "admin-2", Action: "crypto.controls.update", EntityType: "crypto_controls", EntityID: "3", Reason: "incident", CreatedAt: time.Now()}}
	w := h.do("GET", "/api/v1/admin/crypto/audit?action=crypto.controls&actor=admin-2&limit=5000&before=2026-10-22T00:00:00Z", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if al.q.Limit != auditMaxLimit || al.q.ActionPrefix != "crypto.controls" || al.q.Actor != "admin-2" || al.q.Before.IsZero() {
		t.Fatalf("query = %+v", al.q)
	}
	if rows := decode(t, w)["entries"].([]any); len(rows) != 1 {
		t.Fatalf("entries = %v", rows)
	}
	if w := h.do("GET", "/api/v1/admin/crypto/audit?before=yesterday", nil, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("bad cursor -> %d", w.Code)
	}
	al.err = errors.New("db down")
	if w := h.do("GET", "/api/v1/admin/crypto/audit", nil, nil); w.Code != http.StatusInternalServerError {
		t.Fatalf("db error -> %d", w.Code)
	}
}

func TestReconcilerRunNowIsAuditedAnd503WithoutAReconciler(t *testing.T) {
	h, _, _ := adminOpsRig(t)
	if w := h.do("POST", "/api/v1/admin/crypto/reconciler/run", nil, nil); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("no reconciler -> %d", w.Code)
	}
}

func TestAdminDepositsListFiltersByStatus(t *testing.T) {
	h, _, ds := adminOpsRig(t)
	for i, st := range []cryptoprov.DepositStatus{cryptoprov.DepositPending, cryptoprov.DepositAccepted, cryptoprov.DepositPending} {
		_, _, _ = ds.UpsertDeposit(context.Background(), DepositRecord{Provider: "mock", ProviderDepositID: string(rune('a' + i)), UserID: user,
			Currency: "USDT", Amount: decimal.NewFromInt(1), Status: st, CreatedAt: time.Now()})
	}
	w := h.do("GET", "/api/v1/admin/crypto/deposits?status=pending", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	rows := decode(t, w)["deposits"].([]any)
	if len(rows) != 2 || rows[0].(map[string]any)["user_id"] != user {
		t.Fatalf("rows = %v", rows)
	}
	if w := h.do("GET", "/api/v1/admin/crypto/deposits?status=weird", nil, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("bad status -> %d", w.Code)
	}
}
