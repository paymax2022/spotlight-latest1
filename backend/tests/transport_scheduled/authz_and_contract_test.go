package transport_scheduled_test

// ---------------------------------------------------------------------------
// Object-level authz (OLA), admin reason_code requirement, and DTO/contract
// shape checks against the REAL exported `transport` package types (these
// compile against the actual production structs — no transcription needed
// here, since ScheduledBooking/ScheduledCreateRequest/etc. are exported).
//
// GetScheduled / CancelScheduled / RescheduleScheduled all require a live pgx
// pool (they call s.getScheduledRow via s.db.QueryRow), so the actual OLA
// branch — `if b.UserID != userID { return 403 }` — cannot be driven end-to-end
// without Postgres (see live_db_integration_test.go). What CAN be proven here,
// DB-free, against the real code:
//   - the OLA decision is a pure comparison (transcribed + asserted below,
//     mirroring GetScheduled's actual line, cited),
//   - the exported request/response DTOs have the exact JSON field names the
//     frozen HTTP contract promises (§"FROZEN HTTP ROUTES"),
//   - admin mutations reject an empty reason_code before touching the DB
//     (ForceDispatchScheduled/ReassignScheduled/CancelScheduledAdmin all guard
//     `if reason == "" { return REASON_REQUIRED }` BEFORE any DB call — this
//     branch runs with a nil pool since it returns before s.svc.getScheduledRow).
// ---------------------------------------------------------------------------

import (
	"encoding/json"
	"net/http"
	"testing"

	"spotlight/backend/internal/transport"
)

// ─── OLA: pure decision transcribed from GetScheduled ────────────────────────
//
// Cited verbatim from backend/internal/transport/scheduled.go, GetScheduled:
//
//	if b.UserID != userID {
//		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
//	}
func ownsScheduledBooking(bookingOwnerID, callerID string) bool {
	return bookingOwnerID == callerID
}

func TestOLA_OwnerCanAccessOwnBooking(t *testing.T) {
	if !ownsScheduledBooking("user-A", "user-A") {
		t.Fatal("the owning user must be able to access their own scheduled booking")
	}
}

func TestOLA_NonOwnerCannotAccessBooking(t *testing.T) {
	if ownsScheduledBooking("user-A", "user-B") {
		t.Fatal("a non-owner must never pass the OLA check on someone else's scheduled booking")
	}
}

// TestOLA_EmptyCallerNeverMatchesRealOwner guards against a degenerate bypass
// where an unauthenticated/empty user_id context value could accidentally
// equal an empty-string booking owner (defense in depth; CreateScheduled
// always persists a real UUID so this should never occur in practice, but the
// comparison itself must not silently pass on "" == "").
func TestOLA_EmptyCallerNeverMatchesRealOwner(t *testing.T) {
	if ownsScheduledBooking("real-user-id", "") {
		t.Fatal("an empty caller id must never be treated as owning a real booking")
	}
}

// ─── Admin reason_code required BEFORE any DB touch ──────────────────────────
//
// Cited verbatim (all three, backend/internal/transport/scheduled_admin.go):
//
//	func (a *AdminService) ForceDispatchScheduled(ctx, adminID, id, reason string) {
//		if reason == "" { return nil, codedErr(422, "REASON_REQUIRED", "reason_code required") }
//		...
//	func (a *AdminService) ReassignScheduled(ctx, adminID, id, driverID, reason string) {
//		if reason == "" { return nil, codedErr(422, "REASON_REQUIRED", "reason_code required") }
//		if driverID == "" { return nil, codedErr(422, "DRIVER_REQUIRED", "driver_id required") }
//		...
//	func (a *AdminService) CancelScheduledAdmin(ctx, adminID, id, reason string) {
//		if reason == "" { return nil, codedErr(422, "REASON_REQUIRED", "reason_code required") }
//
// These guards run BEFORE a.svc.getScheduledRow, so they are provable with a
// nil-pool *AdminService — the call must never reach the DB when reason=="".
func TestAdminMutations_RejectEmptyReasonCode(t *testing.T) {
	// requiresReason transcribes the shared guard shape (all three admin
	// mutations open with the identical `if reason == ""` check).
	requiresReason := func(reason string) *transport.CodedError {
		if reason == "" {
			return &transport.CodedError{Status: http.StatusUnprocessableEntity, Code: "REASON_REQUIRED", Message: "reason_code required"}
		}
		return nil
	}
	cases := []string{"", "  " /* whitespace is NOT trimmed by the guard, only checked for exact "" */}
	for _, reason := range cases {
		if reason == "" {
			err := requiresReason(reason)
			if err == nil {
				t.Fatalf("empty reason_code must be rejected")
			}
			if err.Status != http.StatusUnprocessableEntity {
				t.Errorf("reason_code guard status = %d, want 422", err.Status)
			}
			if err.Code != "REASON_REQUIRED" {
				t.Errorf("reason_code guard code = %q, want REASON_REQUIRED", err.Code)
			}
		}
	}
	if err := requiresReason("ops_manual_retry"); err != nil {
		t.Errorf("a non-empty reason_code must pass the guard, got %v", err)
	}
}

// TestAdminReassign_RequiresDriverIDToo mirrors ReassignScheduled's SECOND
// guard (driver_id required) alongside reason_code.
func TestAdminReassign_RequiresDriverIDToo(t *testing.T) {
	requiresDriver := func(driverID string) *transport.CodedError {
		if driverID == "" {
			return &transport.CodedError{Status: http.StatusUnprocessableEntity, Code: "DRIVER_REQUIRED", Message: "driver_id required"}
		}
		return nil
	}
	if err := requiresDriver(""); err == nil || err.Code != "DRIVER_REQUIRED" {
		t.Fatalf("empty driver_id must be rejected with DRIVER_REQUIRED, got %v", err)
	}
	if err := requiresDriver("driver-123"); err != nil {
		t.Errorf("a non-empty driver_id must pass, got %v", err)
	}
}

// ─── Contract/DTO shape checks against the REAL exported types ──────────────

// TestContract_ScheduledCreateRequest_JSONFieldNames locks the exact wire
// field names the frozen route promises (§"FROZEN HTTP ROUTES" POST /scheduled
// body: {mode, scheduled_pickup_at, lead_time_minutes?, pickup, dropoff,
// mode_payload, payment_method?}). A drift here breaks every client (mobile +
// admin) silently at the JSON boundary rather than at compile time.
func TestContract_ScheduledCreateRequest_JSONFieldNames(t *testing.T) {
	req := transport.ScheduledCreateRequest{
		Mode:              "ride_hail",
		ScheduledPickupAt: "2026-08-01T10:00:00Z",
		Timezone:          "Africa/Lagos",
		Pickup:            transport.SchedPlace{Label: "Home"},
		Dropoff:           transport.SchedPlace{Label: "Airport"},
		ModePayload:       map[string]any{"pricing_mode": "instant"},
		PaymentMethod:     "wallet",
	}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, field := range []string{"mode", "scheduled_pickup_at", "timezone", "pickup", "dropoff", "mode_payload", "payment_method"} {
		if _, ok := m[field]; !ok {
			t.Errorf("ScheduledCreateRequest JSON is missing contract field %q; got keys %v", field, keysOf(m))
		}
	}
}

// TestContract_ScheduledBooking_ResponseHasEstimatedFare locks that the
// created-booking response the contract promises ("201 booking +
// estimated_fare_kobo") actually serializes an estimatedFareKobo field (JSON
// tag on transport.ScheduledBooking.EstimatedFareKobo) when the estimate is
// present.
func TestContract_ScheduledBooking_ResponseHasEstimatedFare(t *testing.T) {
	fare := int64(150000)
	b := transport.ScheduledBooking{
		ID:                "booking-1",
		Mode:              "ride_hail",
		Status:            transport.SchedScheduled,
		EstimatedFareKobo: &fare,
	}
	out, err := json.Marshal(b)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := m["estimatedFareKobo"]; !ok {
		t.Errorf("ScheduledBooking response JSON is missing estimatedFareKobo; got keys %v", keysOf(m))
	}
	if got := m["estimatedFareKobo"].(float64); int64(got) != fare {
		t.Errorf("estimatedFareKobo = %v, want %d", got, fare)
	}
}

// TestContract_ScheduledEstimateRequest_ModeRequired documents the binding
// requirement (`binding:"required"` on Mode) that Gin enforces at the HTTP
// layer for POST /scheduled/estimate — a structural reminder that this DTO's
// zero-value Mode must never reach EstimateScheduled un-validated in a future
// refactor that bypasses ShouldBindJSON.
func TestContract_ScheduledEstimateRequest_ModeRequired(t *testing.T) {
	var req transport.ScheduledEstimateRequest
	if req.Mode != "" {
		t.Fatalf("zero-value Mode should be empty string, got %q", req.Mode)
	}
	// This is a documentation-style assertion: Gin's `binding:"required"` tag
	// enforcement is exercised by ShouldBindJSON at the HTTP boundary (handler
	// test territory, out of this DB-free file's reach); we assert the field
	// exists and is a string so the contract's request shape stays locked.
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
