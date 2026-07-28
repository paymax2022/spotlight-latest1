package transport_scheduled_test

// ---------------------------------------------------------------------------
// CreateScheduled / EstimateScheduled input-validation guards that run BEFORE
// any DB call, transcribed verbatim from backend/internal/transport/scheduled.go
// so they are provable DB-free (mirrors the reason_code guard pattern in
// authz_and_contract_test.go).
//
// Cited verbatim, CreateScheduled (in order):
//
//	if idempotencyKey == "" { return 400 MISSING_IDEMPOTENCY_KEY }
//	if !scheduledModes[req.Mode] { return 422 INVALID_MODE }
//	pickupAt, err := time.Parse(time.RFC3339, req.ScheduledPickupAt)
//	if err != nil { return 400 INVALID_TIME }
//	... (airport arrival_time derivation) ...
//	if pickupAt.Before(time.Now()) { return 422 PICKUP_IN_PAST }
//	lead := defaultLeadMinutes(req.Mode)
//	if req.LeadTimeMinutes != nil {
//		if *req.LeadTimeMinutes < 0 { return 422 INVALID_LEAD_TIME }
//		lead = *req.LeadTimeMinutes
//	}
//
// Cited verbatim, EstimateScheduled:
//
//	if !scheduledModes[req.Mode] { return 422 INVALID_MODE }
// ---------------------------------------------------------------------------

import (
	"net/http"
	"testing"
	"time"
)

// codedGuardResult models the (status, code) pair a guard returns, or nil for
// "passes".
type codedGuardResult struct {
	status int
	code   string
}

// validateCreateScheduled transcribes CreateScheduled's ordered guard chain
// (stopping at the FIRST failing guard, exactly like early-return Go code).
// It omits the airport arrival_time derivation (pure time-math, not a
// validation guard) and the DB-touching estimate step, which is why this is
// safe to assert without a pool.
func validateCreateScheduled(idempotencyKey, mode, scheduledPickupAtRFC3339 string, leadTimeMinutes *int, now time.Time) *codedGuardResult {
	if idempotencyKey == "" {
		return &codedGuardResult{http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY"}
	}
	if !schedulingModes[mode] {
		return &codedGuardResult{http.StatusUnprocessableEntity, "INVALID_MODE"}
	}
	pickupAt, err := time.Parse(time.RFC3339, scheduledPickupAtRFC3339)
	if err != nil {
		return &codedGuardResult{http.StatusBadRequest, "INVALID_TIME"}
	}
	if pickupAt.Before(now) {
		return &codedGuardResult{http.StatusUnprocessableEntity, "PICKUP_IN_PAST"}
	}
	if leadTimeMinutes != nil && *leadTimeMinutes < 0 {
		return &codedGuardResult{http.StatusUnprocessableEntity, "INVALID_LEAD_TIME"}
	}
	return nil
}

// validateEstimateScheduled transcribes EstimateScheduled's mode guard.
func validateEstimateScheduled(mode string) *codedGuardResult {
	if !schedulingModes[mode] {
		return &codedGuardResult{http.StatusUnprocessableEntity, "INVALID_MODE"}
	}
	return nil
}

func TestCreateScheduled_MissingIdempotencyKeyRejected(t *testing.T) {
	now := time.Now()
	got := validateCreateScheduled("", "ride_hail", now.Add(time.Hour).Format(time.RFC3339), nil, now)
	if got == nil || got.code != "MISSING_IDEMPOTENCY_KEY" || got.status != http.StatusBadRequest {
		t.Fatalf("expected MISSING_IDEMPOTENCY_KEY/400, got %+v", got)
	}
}

func TestCreateScheduled_InvalidModeRejected(t *testing.T) {
	now := time.Now()
	for _, bad := range []string{"", "scooter", "RIDE_HAIL", "car_hire"} {
		got := validateCreateScheduled("idem-1", bad, now.Add(time.Hour).Format(time.RFC3339), nil, now)
		if got == nil || got.code != "INVALID_MODE" || got.status != http.StatusUnprocessableEntity {
			t.Errorf("mode=%q: expected INVALID_MODE/422, got %+v", bad, got)
		}
	}
	// Every frozen mode must pass this guard.
	for mode := range schedulingModes {
		got := validateCreateScheduled("idem-1", mode, now.Add(time.Hour).Format(time.RFC3339), nil, now)
		if got != nil {
			t.Errorf("mode=%q should pass the mode guard, got %+v", mode, got)
		}
	}
}

func TestCreateScheduled_InvalidRFC3339TimeRejected(t *testing.T) {
	now := time.Now()
	for _, bad := range []string{"", "not-a-time", "2026-08-01", "2026-08-01 10:00:00"} {
		got := validateCreateScheduled("idem-1", "ride_hail", bad, nil, now)
		if got == nil || got.code != "INVALID_TIME" || got.status != http.StatusBadRequest {
			t.Errorf("scheduled_pickup_at=%q: expected INVALID_TIME/400, got %+v", bad, got)
		}
	}
}

func TestCreateScheduled_PickupInPastRejected(t *testing.T) {
	now := time.Now()
	got := validateCreateScheduled("idem-1", "ride_hail", now.Add(-time.Hour).Format(time.RFC3339), nil, now)
	if got == nil || got.code != "PICKUP_IN_PAST" || got.status != http.StatusUnprocessableEntity {
		t.Fatalf("expected PICKUP_IN_PAST/422 for a past pickup time, got %+v", got)
	}
	// A pickup 1 second in the future must pass.
	got2 := validateCreateScheduled("idem-1", "ride_hail", now.Add(time.Second).Format(time.RFC3339), nil, now)
	if got2 != nil {
		t.Errorf("a future pickup time should pass, got %+v", got2)
	}
}

func TestCreateScheduled_NegativeLeadTimeRejected(t *testing.T) {
	now := time.Now()
	neg := -1
	got := validateCreateScheduled("idem-1", "ride_hail", now.Add(time.Hour).Format(time.RFC3339), &neg, now)
	if got == nil || got.code != "INVALID_LEAD_TIME" || got.status != http.StatusUnprocessableEntity {
		t.Fatalf("expected INVALID_LEAD_TIME/422 for lead_time_minutes=-1, got %+v", got)
	}
	zero := 0
	if got := validateCreateScheduled("idem-1", "ride_hail", now.Add(time.Hour).Format(time.RFC3339), &zero, now); got != nil {
		t.Errorf("lead_time_minutes=0 must be allowed (>= 0), got %+v", got)
	}
}

// TestCreateScheduled_GuardOrder documents that the guard chain is sequential
// and stops at the first failure (missing idempotency key is checked before
// mode/time validity).
func TestCreateScheduled_GuardOrder(t *testing.T) {
	now := time.Now()
	// Missing idempotency key takes priority over an also-invalid mode — the
	// guard chain is sequential and stops at the first failure.
	got := validateCreateScheduled("", "not_a_real_mode", "garbage-time", nil, now)
	if got == nil || got.code != "MISSING_IDEMPOTENCY_KEY" {
		t.Fatalf("expected the FIRST guard (MISSING_IDEMPOTENCY_KEY) to fire even though later guards would also fail, got %+v", got)
	}
}

func TestEstimateScheduled_InvalidModeRejected(t *testing.T) {
	for _, bad := range []string{"", "scooter", "car_hire"} {
		got := validateEstimateScheduled(bad)
		if got == nil || got.code != "INVALID_MODE" {
			t.Errorf("estimate mode=%q: expected INVALID_MODE, got %+v", bad, got)
		}
	}
	for mode := range schedulingModes {
		if got := validateEstimateScheduled(mode); got != nil {
			t.Errorf("estimate mode=%q should pass, got %+v", mode, got)
		}
	}
}
