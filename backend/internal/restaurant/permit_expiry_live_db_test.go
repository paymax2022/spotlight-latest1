package restaurant

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

// FOOD-UAT-H-002: an expired permit closes the store, blocks re-opening, and a
// renewed (future) permit lifts the hold so the owner can open again.
func TestLiveDB_PermitExpiry_BlocksOpenUntilRenewed(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, settlement.NewService(pool, nil))

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, owner)
	rid := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, kyb_status, permit_expires_at)
	  VALUES ($1,$2,'Permit Kitchen','1 St',TRUE,'approved', NOW() - INTERVAL '1 day')`, rid, owner); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM restaurants WHERE id=$1`, rid) })

	n, err := svc.SweepPermitExpiry(ctx, time.Now())
	if err != nil || n < 1 {
		t.Fatalf("sweep closed=%d err=%v", n, err)
	}
	var open bool
	var hold *string
	_ = pool.QueryRow(ctx, `SELECT is_open, compliance_hold_reason FROM restaurants WHERE id=$1`, rid).Scan(&open, &hold)
	if open || hold == nil || *hold != "permit_expired" {
		t.Fatalf("after sweep open=%v hold=%v", open, hold)
	}
	if n2, _ := svc.SweepPermitExpiry(ctx, time.Now()); n2 != 0 {
		t.Errorf("second sweep must be a no-op, closed %d", n2)
	}

	h := NewHandler(svc)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", owner) })
	r.PATCH("/:id/availability", h.RequirePermitValidToOpen(), h.SetAvailability)
	r.PUT("/:id/permit", h.AdminSetPermit)
	call := func(method, path, body string) int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		return w.Code
	}
	if code := call(http.MethodPatch, "/"+rid+"/availability", `{"is_open":true}`); code != http.StatusForbidden {
		t.Fatalf("open with expired permit = %d, want 403", code)
	}
	if code := call(http.MethodPatch, "/"+rid+"/availability", `{"is_open":false}`); code != http.StatusOK {
		t.Fatalf("closing must stay allowed, got %d", code)
	}
	future := time.Now().Add(90 * 24 * time.Hour).UTC().Format(time.RFC3339)
	if code := call(http.MethodPut, "/"+rid+"/permit", `{"expires_at":"`+future+`","document_url":"https://r2.example/permit.pdf"}`); code != http.StatusOK {
		t.Fatalf("renew permit = %d", code)
	}
	_ = pool.QueryRow(ctx, `SELECT compliance_hold_reason FROM restaurants WHERE id=$1`, rid).Scan(&hold)
	if hold != nil {
		t.Errorf("hold should be lifted, got %q", *hold)
	}
	if code := call(http.MethodPatch, "/"+rid+"/availability", `{"is_open":true}`); code != http.StatusOK {
		t.Fatalf("open after renewal = %d, want 200", code)
	}

	// no permit on file at all -> cannot open
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET is_open=FALSE, permit_expires_at=NULL WHERE id=$1`, rid); err != nil {
		t.Fatal(err)
	}
	if code := call(http.MethodPatch, "/"+rid+"/availability", `{"is_open":true}`); code != http.StatusForbidden {
		t.Fatalf("open with NULL permit = %d, want 403", code)
	}
}
