package restaurant

// LIVE-DB regression for FOOD-UAT-F-002 (two-tier refund approval). The gate is
// exercised against real orders/disputes/refund_tier_config rows with a stub
// downstream handler, so no ledger money moves. Needs migration 20271064000012.

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

type w5ccTestRBAC map[string]map[string]bool

func (f w5ccTestRBAC) CheckPermission(userID, perm, _, _ string) (bool, error) {
	return f[userID][perm], nil
}

func TestLiveDB_RefundApprovalTiers(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := t.Context()
	svc := NewService(pool, nil)
	aud := &w5ccTestAuditor{}
	svc.WithAudit(aud)

	owner, customer, basic, lead := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, customer, basic, lead} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Refund Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	var threshold int64
	if err := pool.QueryRow(ctx, `SELECT threshold_kobo FROM refund_tier_config ORDER BY effective_from DESC, created_at DESC LIMIT 1`).Scan(&threshold); err != nil {
		t.Fatalf("threshold row: %v", err)
	}
	seedDispute := func(total int64) string {
		orderID, disputeID := uuid.New().String(), uuid.New().String()
		if _, err := pool.Exec(ctx, `
			INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address)
			VALUES ($1,$2,$3,$4,$4,'delivered',$5,'1 Test Street')`, orderID, customer, restID, total, "ra-"+orderID); err != nil {
			t.Fatalf("seed order: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO disputes (id, user_id, reference, module_type, type, description) VALUES ($1,$2,$3,'food','other','probe')`, disputeID, customer, orderID); err != nil {
			t.Fatalf("seed dispute: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(t.Context(), `DELETE FROM disputes WHERE id=$1`, disputeID)
			_, _ = pool.Exec(t.Context(), `DELETE FROM orders WHERE id=$1`, orderID)
		})
		return disputeID
	}
	small, large := seedDispute(threshold/2), seedDispute(threshold*2)

	rbac := w5ccTestRBAC{basic: {}, lead: {PermRefundLarge: true}}
	gin.SetMode(gin.TestMode)
	call := func(user, disputeID, body string) (int, bool) {
		reached := false
		r := gin.New()
		r.POST("/disputes/:id/resolve", func(c *gin.Context) { c.Set("user_id", user) },
			NewHandler(svc).RefundApprovalGate(rbac),
			func(c *gin.Context) { reached = true; c.JSON(http.StatusOK, gin.H{"ok": true}) })
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/disputes/"+disputeID+"/resolve", bytes.NewBufferString(body))
		r.ServeHTTP(w, req)
		return w.Code, reached
	}

	// (a) small refund by a basic admin succeeds (auto tier), including "full" with no amount.
	if code, reached := call(basic, small, `{"resolution":"refund_full"}`); code != 200 || !reached {
		t.Fatalf("small refund by basic admin: code=%d reached=%v", code, reached)
	}
	last := aud.calls[len(aud.calls)-1]
	if last.action != "restaurant.refund.approved" || last.newValues["tier"] != "auto" || last.newValues["threshold_kobo"] != threshold {
		t.Fatalf("auto audit: %+v", last)
	}

	// Non-refund resolutions are never gated.
	if code, _ := call(basic, large, `{"resolution":"dismissed"}`); code != 200 {
		t.Fatalf("dismissal must not be gated, got %d", code)
	}

	// (b) large refund (explicit partial above threshold, and implicit full) by a basic admin -> 403.
	for _, body := range []string{`{"resolution":"refund_full"}`, `{"resolution":"refund_partial","refund_kobo":` + w5ccItoa(threshold+1) + `}`, `{"resolution":"refunded"}`} {
		code, reached := call(basic, large, body)
		if code != http.StatusForbidden || reached {
			t.Fatalf("large refund %s by basic admin: code=%d reached=%v, want 403 and blocked", body, code, reached)
		}
	}
	// ...but a partial AT/below the threshold on the large order is fine for a basic admin.
	if code, _ := call(basic, large, `{"resolution":"refund_partial","refund_kobo":`+w5ccItoa(threshold)+`}`); code != 200 {
		t.Fatalf("partial at threshold by basic admin: code=%d, want 200", code)
	}
	var sawDenied bool
	for _, a := range aud.calls {
		if a.action == "restaurant.refund.denied" && a.actor == basic && a.newValues["tier"] == "elevated" {
			sawDenied = true
		}
	}
	if !sawDenied {
		t.Fatalf("denied decision not audited: %+v", aud.calls)
	}

	// (c) large refund by a refund_large admin -> 200 + audit row (actor, amount, threshold, elevated).
	before := len(aud.calls)
	code, reached := call(lead, large, `{"resolution":"refund_full"}`)
	if code != 200 || !reached {
		t.Fatalf("large refund by lead: code=%d reached=%v", code, reached)
	}
	if len(aud.calls) != before+1 {
		t.Fatalf("want exactly one new audit row, got %d", len(aud.calls)-before)
	}
	row := aud.calls[len(aud.calls)-1]
	if row.action != "restaurant.refund.approved" || row.actor != lead || row.resource != large ||
		row.newValues["tier"] != "elevated" || row.newValues["amount_kobo"] != threshold*2 || row.newValues["threshold_kobo"] != threshold {
		t.Fatalf("elevated audit row: %+v", row)
	}
}

func w5ccItoa(n int64) string { return strconv.FormatInt(n, 10) }
