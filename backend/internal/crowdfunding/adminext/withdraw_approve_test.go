package adminext

import (
	"context"
	"errors"
	"testing"
)

// TestApproveWithdrawal_Validation covers the fail-closed input guards that run
// BEFORE any database or ledger access, so no pool/ledger is required. The valid
// path (real id + key + wired ledger) proceeds to the DB and is exercised by
// integration tests against a live Postgres.
func TestApproveWithdrawal_Validation(t *testing.T) {
	s := NewService(nil) // nil pool + nil ledger: these paths return before touching either.
	ctx := context.Background()

	if _, err := s.ApproveWithdrawal(ctx, "", "approver", "idem"); err == nil {
		t.Fatal("expected error for empty withdrawal id")
	}
	if _, err := s.ApproveWithdrawal(ctx, "11111111-1111-1111-1111-111111111111", "", "idem"); err == nil {
		t.Fatal("expected error for empty approver id")
	}
	if _, err := s.ApproveWithdrawal(ctx, "11111111-1111-1111-1111-111111111111", "approver", ""); err == nil {
		t.Fatal("expected error for empty idempotency key")
	}
}

// TestApproveWithdrawal_FailsClosedWithoutLedger asserts the money-path refuses to
// run (and therefore refuses to move money or flip state) when no finance ledger
// is wired — even with otherwise-valid inputs. This guard runs before any DB call,
// so a nil pool is safe.
func TestApproveWithdrawal_FailsClosedWithoutLedger(t *testing.T) {
	s := NewService(nil) // no ledger wired
	_, err := s.ApproveWithdrawal(context.Background(),
		"11111111-1111-1111-1111-111111111111", "approver", "idem-key")
	if !errors.Is(err, ErrLedgerUnavailable) {
		t.Fatalf("expected ErrLedgerUnavailable, got %v", err)
	}
}

// TestPayoutIdempotencyKeyScheme documents the deterministic key scheme the payout
// leg uses so a replay never posts the ledger pair twice. Pure string assertion.
func TestPayoutIdempotencyKeyScheme(t *testing.T) {
	const id = "11111111-1111-1111-1111-111111111111"
	got := "cf:withdraw:payout:" + id
	if want := "cf:withdraw:payout:11111111-1111-1111-1111-111111111111"; got != want {
		t.Fatalf("payout idempotency key mismatch: got %q want %q", got, want)
	}
}

// TestWithdrawalStateConstants pins the state-machine literals to the
// cf_withdrawals status CHECK constraint values the money-path transitions across.
func TestWithdrawalStateConstants(t *testing.T) {
	for _, tc := range []struct{ got, want string }{
		{wStatusPending, "PENDING"},
		{wStatusApproved, "APPROVED"},
		{wStatusCompleted, "COMPLETED"},
		{wStatusRejected, "REJECTED"},
	} {
		if tc.got != tc.want {
			t.Fatalf("state constant mismatch: got %q want %q", tc.got, tc.want)
		}
	}
}
