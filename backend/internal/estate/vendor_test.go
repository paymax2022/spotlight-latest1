package estate

import (
	"context"
	"testing"
)

// TestRequestPayoutRequiresIdempotencyKey: the vendor payout money path must fail
// closed without an Idempotency-Key, before touching the ledger.
func TestRequestPayoutRequiresIdempotencyKey(t *testing.T) {
	svc := NewService(nil, nil) // guard runs before any db/ledger access
	_, err := svc.RequestPayout(context.Background(), "estate-1", "vendor-user", "job-1", "")
	if err != ErrIdempotencyRequired {
		t.Fatalf("expected ErrIdempotencyRequired, got %v", err)
	}
}

// TestRequestPayoutRequiresLedger: with a key but no ledger wired, payout must
// fail closed with ErrLedgerUnavailable (never silently succeed).
func TestRequestPayoutRequiresLedger(t *testing.T) {
	svc := NewService(nil, nil) // no ledger
	_, err := svc.RequestPayout(context.Background(), "estate-1", "vendor-user", "job-1", "key-123")
	if err != ErrLedgerUnavailable {
		t.Fatalf("expected ErrLedgerUnavailable, got %v", err)
	}
}
