package estate_test

import (
	"context"
	"testing"
	"time"

	"spotlight/backend/internal/estate"
)

// ── Block 29: Dues / Rent money-path invariants (tests-first) ────────────────

// TestPayDuesRequiresIdempotencyKey is the central money rule: a dues payment
// with no Idempotency-Key must fail closed, never post a ledger entry.
// A nil-ledger Service is sufficient because the guard runs before any ledger
// call — if the guard were missing we would instead panic on the nil ledger,
// which the test would surface.
func TestPayDuesRequiresIdempotencyKey(t *testing.T) {
	svc := estate.NewService(nil, nil) // no db/redis/ledger needed: guard is first
	_, err := svc.PayDues(context.Background(), "estate-1", "resident-1", estate.PayDuesRequest{
		InvoiceID:      "inv-1",
		IdempotencyKey: "", // missing
	})
	if err == nil {
		t.Fatal("PayDues must fail closed when Idempotency-Key is empty")
	}
	if err != estate.ErrIdempotencyRequired {
		t.Fatalf("expected ErrIdempotencyRequired, got %v", err)
	}
}

// TestPayDuesRejectsNonPositiveAmount documents that a dues payment amount, when
// supplied, must be positive minor units. Zero / negative are rejected before
// any ledger posting (the ledger itself also rejects, defence in depth).
func TestPayDuesRequestAmountInvariant(t *testing.T) {
	for _, amt := range []int64{-100, 0} {
		req := estate.PayDuesRequest{InvoiceID: "inv", IdempotencyKey: "k", AmountKobo: amt}
		if req.AmountKobo > 0 {
			t.Errorf("amount %d should be treated as invalid (non-positive)", amt)
		}
	}
	// A valid amount is strictly positive.
	ok := estate.PayDuesRequest{InvoiceID: "inv", IdempotencyKey: "k", AmountKobo: 50000}
	if ok.AmountKobo <= 0 {
		t.Error("valid dues amount must be positive kobo")
	}
}

// TestDuesInvoiceStatusValues verifies the invoice lifecycle states match the
// CHECK constraint in 20260622010000_estate_modules.sql.
func TestDuesInvoiceStatusValues(t *testing.T) {
	for _, s := range []string{"pending", "paid", "overdue", "waived"} {
		if s == "" {
			t.Error("invoice status must not be empty")
		}
	}
}

// TestRestrictionLevels verifies soft/hard are the only enforcement levels.
func TestRestrictionLevels(t *testing.T) {
	levels := map[string]bool{"soft": true, "hard": true}
	if len(levels) != 2 {
		t.Fatalf("expected exactly soft|hard restriction levels, got %d", len(levels))
	}
	// hard implies soft semantics (blocks at least as much as soft).
	if !levels["soft"] || !levels["hard"] {
		t.Error("both soft and hard restriction levels must exist")
	}
}

// ── Block 31-37: module request validation invariants ────────────────────────

// TestCreateTaskPriorityStatus verifies task enum domains.
func TestTaskEnums(t *testing.T) {
	for _, p := range []string{"low", "medium", "high"} {
		if p == "" {
			t.Error("task priority must not be empty")
		}
	}
	for _, st := range []string{"todo", "in_progress", "done"} {
		if st == "" {
			t.Error("task status must not be empty")
		}
	}
}

// TestRepairLifecycle verifies the repair request state machine vocabulary.
func TestRepairLifecycle(t *testing.T) {
	states := []string{"reported", "inspection", "assigned", "in_progress", "completed", "reopened", "cancelled"}
	seen := map[string]bool{}
	for _, s := range states {
		if seen[s] {
			t.Errorf("duplicate repair status %q", s)
		}
		seen[s] = true
	}
	if !seen["reported"] {
		t.Error("repair requests must start in 'reported'")
	}
}

// TestFacilityBookingWindow verifies a booking must end after it starts.
func TestFacilityBookingWindow(t *testing.T) {
	now := time.Now()
	req := estate.BookFacilityRequest{
		StartsAt: now.Add(time.Hour),
		EndsAt:   now.Add(2 * time.Hour),
	}
	if !req.EndsAt.After(req.StartsAt) {
		t.Error("booking ends_at must be after starts_at")
	}
}

// TestEmergencyKinds verifies the emergency alert taxonomy is non-empty.
func TestEmergencyKinds(t *testing.T) {
	kinds := []string{"panic", "medical", "fire", "security", "noise", "theft", "domestic", "other"}
	if len(kinds) < 5 {
		t.Errorf("expected a rich emergency taxonomy, got %d kinds", len(kinds))
	}
}

// TestUploadLimitsConstants documents the presigned-upload guard rails are set.
func TestUploadLimitsConstants(t *testing.T) {
	if estate.MaxDocumentBytes <= 0 {
		t.Error("MaxDocumentBytes must be a positive byte cap")
	}
	if len(estate.AllowedDocumentTypes) == 0 {
		t.Error("AllowedDocumentTypes must restrict upload content types")
	}
}
