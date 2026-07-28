package ledger

import (
	"context"
	"testing"
)

// TestWithdrawEligible_Validation covers the fail-closed input guards that run
// before any database access, so no pool is required. A valid beneficiary +
// key would proceed to the KYC/DB path and is exercised by integration tests
// (which require a live Postgres — see docs/referral-integration-plan.md).
func TestWithdrawEligible_Validation(t *testing.T) {
	s := NewService(nil, nil) // nil pool is safe: these paths return before touching it.
	ctx := context.Background()

	if _, err := s.WithdrawEligible(ctx, "", "idem-key"); err == nil {
		t.Fatal("expected error for empty beneficiary id")
	}
	if _, err := s.WithdrawEligible(ctx, "11111111-1111-1111-1111-111111111111", ""); err == nil {
		t.Fatal("expected error for empty idempotency key")
	}
}

// TestMinWithdrawTier documents the KYC floor the withdraw path enforces.
func TestMinWithdrawTier(t *testing.T) {
	if MinWithdrawTier < 1 {
		t.Fatalf("MinWithdrawTier must be >= 1 (KYC-gated), got %d", MinWithdrawTier)
	}
}

// TestSetAuditSink verifies the optional sink is wired without a DB.
func TestSetAuditSink(t *testing.T) {
	s := NewService(nil, nil)
	called := false
	s.SetAuditSink(func(ctx context.Context, event, userID string, payload map[string]any, idem string) error {
		called = true
		return nil
	})
	if s.audit == nil {
		t.Fatal("audit sink not set")
	}
	_ = s.audit(context.Background(), "e", "u", nil, "k")
	if !called {
		t.Fatal("audit sink not invoked")
	}
}
