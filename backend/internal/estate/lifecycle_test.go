package estate

// Unit tests for the estate lifecycle state machine (lifecycle.go) — the pure
// parts: transition table, reason validation, gate exemptions, error mapping.
// The DB-backed paths (TransitionEstate, AssertEstateWritable, SetLegalHold)
// are covered in lifecycle_live_db_test.go.

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLifecycleTarget_TransitionTable(t *testing.T) {
	cases := []struct {
		from, action, want string
		ok                 bool
	}{
		{EstateStatusPending, LifecycleVerify, EstateStatusActive, true},
		{EstateStatusPending, LifecycleReject, EstateStatusClosed, true},
		{EstateStatusPending, LifecycleSuspend, "", false},
		{EstateStatusPending, LifecycleReactivate, "", false},
		{EstateStatusPending, LifecycleClose, "", false},
		{EstateStatusActive, LifecycleSuspend, EstateStatusSuspended, true},
		{EstateStatusActive, LifecycleClose, EstateStatusClosed, true},
		{EstateStatusActive, LifecycleVerify, "", false},
		{EstateStatusActive, LifecycleReject, "", false},
		{EstateStatusActive, LifecycleReactivate, "", false},
		{EstateStatusSuspended, LifecycleReactivate, EstateStatusActive, true},
		{EstateStatusSuspended, LifecycleClose, EstateStatusClosed, true},
		{EstateStatusSuspended, LifecycleVerify, "", false},
		{EstateStatusSuspended, LifecycleSuspend, "", false},
		{EstateStatusClosed, LifecycleVerify, "", false},
		{EstateStatusClosed, LifecycleReactivate, "", false},
		{EstateStatusClosed, LifecycleClose, "", false},
		{EstateStatusActive, "bogus", "", false},
	}
	for _, c := range cases {
		got, ok := lifecycleTarget(c.from, c.action)
		// `to` is only meaningful when ok — invalid rows expect "" anyway.
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("lifecycleTarget(%q,%q) = (%q,%v), want (%q,%v)", c.from, c.action, got, ok, c.want, c.ok)
		}
	}
}

func TestNormaliseReason(t *testing.T) {
	if _, err := normaliseReason(""); !errors.Is(err, ErrLifecycleReasonRequired) {
		t.Errorf("empty reason: got %v, want ErrLifecycleReasonRequired", err)
	}
	if _, err := normaliseReason("  ab "); !errors.Is(err, ErrLifecycleReasonRequired) {
		t.Errorf("short reason: got %v, want ErrLifecycleReasonRequired", err)
	}
	r, err := normaliseReason("  unpaid platform fees  ")
	if err != nil || r != "unpaid platform fees" {
		t.Errorf("valid reason = (%q,%v), want trimmed, nil", r, err)
	}
	long := make([]byte, 1500)
	for i := range long {
		long[i] = 'x'
	}
	r, err = normaliseReason(string(long))
	if err != nil || len(r) != 1000 {
		t.Errorf("overlong reason = (%d,%v), want 1000 chars, nil", len(r), err)
	}
}

func TestLifecycleExempt(t *testing.T) {
	exempt := []string{
		"/api/finance/estate/:id/emergencies",
		"/api/finance/estate/:id/emergencies/:alertId/status",
		"/api/finance/estate/:id/guard/incident",
		"/api/finance/estate/:id/guard/checkout",
		"/api/finance/estate/:id/guard/sync",
		"/api/finance/estate/:id/access-codes/:cid/revoke",
		"/api/finance/estate/:id/access-codes/:cid/blacklist",
	}
	for _, p := range exempt {
		if !lifecycleExempt(p) {
			t.Errorf("lifecycleExempt(%q) = false, want true", p)
		}
	}
	blocked := []string{
		"/api/finance/estate/:id/dues/invoices/:invoiceId/pay",
		"/api/finance/estate/:id/residents",
		"/api/finance/estate/:id/passes",
		"/api/finance/estate/:id/passes/scan",
		"/api/finance/estate/:id/guard/checkin",
		"/api/finance/estate/:id/guard/shift-handover",
		"/api/finance/estate/:id/access-codes",
		"/api/finance/estate/:id/access-codes/:cid/extend",
		"/api/finance/estate/:id/account",
	}
	for _, p := range blocked {
		if lifecycleExempt(p) {
			t.Errorf("lifecycleExempt(%q) = true, want false", p)
		}
	}
}

func TestIsEstateNotActive(t *testing.T) {
	if !IsEstateNotActive(&EstateNotActiveError{Status: EstateStatusSuspended}) {
		t.Error("IsEstateNotActive(&EstateNotActiveError) = false")
	}
	if IsEstateNotActive(ErrEstateNotFound) || IsEstateNotActive(nil) {
		t.Error("IsEstateNotActive misclassified a non-lifecycle error")
	}
}

// TestLifecycleGate_ReadsPassAndBadIDsFallThrough exercises the middleware
// shape that does not need a DB: GET always passes, and a non-UUID :id falls
// through to the handler's own membership check.
func TestLifecycleGate_ReadsPassAndBadIDsFallThrough(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(nil)
	r := gin.New()
	g := r.Group("/estate")
	g.Use(h.LifecycleGate())
	g.GET("/:id/documents", func(c *gin.Context) { c.Status(204) })
	g.POST("/:id/documents", func(c *gin.Context) { c.Status(204) })

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), "GET", "/estate/not-a-uuid/documents", nil)
	r.ServeHTTP(w, req)
	if w.Code != 204 {
		t.Errorf("GET passed through = %d, want 204", w.Code)
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequestWithContext(context.Background(), "POST", "/estate/not-a-uuid/documents", nil)
	r.ServeHTTP(w, req)
	if w.Code != 204 {
		t.Errorf("POST with non-uuid id fell through = %d, want 204", w.Code)
	}
}
