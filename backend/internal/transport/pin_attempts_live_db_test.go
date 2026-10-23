package transport

// LIVE-DB tests for the hand-off PIN attempt guard (checkPin). Skipped unless
// TEST_DATABASE_URL is set. Pins the brute-force fix: a 4-digit PIN can no
// longer be guessed by scripting the verify endpoint.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func pinStatus(t *testing.T, err error) (int, string) {
	t.Helper()
	if err == nil {
		return 0, ""
	}
	var ce *CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("want a CodedError, got %v", err)
	}
	return ce.Status, ce.Code
}

func newPinSvc(t *testing.T) (*Service, string) {
	t.Helper()
	pool := paystackRidePool(t)
	svc := NewService(pool, nil)
	id := "pin-test-" + uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.transport_pin_attempts WHERE entity_id=$1`, id)
	})
	return svc, id
}

func TestLiveDB_PinGuard_CorrectPinPassesAndResets(t *testing.T) {
	svc, id := newPinSvc(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		_ = svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "0000", "")
	}
	if err := svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "4821", ""); err != nil {
		t.Fatalf("correct PIN after 3 misses must pass: %v", err)
	}
	// The count reset: 4 more misses still do not trigger the cooldown.
	for i := 0; i < 4; i++ {
		if st, code := pinStatus(t, svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "0000", "")); st != http.StatusUnprocessableEntity || code != CodePinMismatch {
			t.Fatalf("miss %d after reset: %d %s, want 422 PIN_MISMATCH", i+1, st, code)
		}
	}
}

func TestLiveDB_PinGuard_CooldownRefusesEvenTheRightPin(t *testing.T) {
	svc, id := newPinSvc(t)
	ctx := context.Background()
	for i := 1; i <= 4; i++ {
		if st, _ := pinStatus(t, svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "1111", "")); st != http.StatusUnprocessableEntity {
			t.Fatalf("miss %d: status %d, want 422", i, st)
		}
	}
	if st, code := pinStatus(t, svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "1111", "")); st != http.StatusTooManyRequests || code != CodePinLocked {
		t.Fatalf("5th miss: %d %s, want 429 PIN_LOCKED", st, code)
	}
	if st, code := pinStatus(t, svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "4821", "")); st != http.StatusTooManyRequests || code != CodePinLocked {
		t.Fatalf("correct PIN during cooldown: %d %s, want 429 PIN_LOCKED", st, code)
	}
	// Once the cooldown has passed, the right PIN works.
	if _, err := svc.db.Exec(ctx, `UPDATE public.transport_pin_attempts SET locked_until=now()-interval '1 second' WHERE entity_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err := svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "4821", ""); err != nil {
		t.Fatalf("correct PIN after the cooldown: %v", err)
	}
}

func TestLiveDB_PinGuard_HardLockAfterFifteenNeedsSupport(t *testing.T) {
	svc, id := newPinSvc(t)
	ctx := context.Background()
	for i := 1; i <= pinHardLockAt; i++ {
		_ = svc.checkPin(ctx, "trip", id, "start", "4821", "9999", "")
		// Skip each cooldown so the test reaches the hard lock.
		_, _ = svc.db.Exec(ctx, `UPDATE public.transport_pin_attempts SET locked_until=NULL WHERE entity_id=$1`, id)
	}
	if st, code := pinStatus(t, svc.checkPin(ctx, "trip", id, "start", "4821", "4821", "")); st != http.StatusLocked || code != CodePinLocked {
		t.Fatalf("after %d misses: %d %s, want 423 PIN_LOCKED even for the right PIN", pinHardLockAt, st, code)
	}
}

func TestLiveDB_PinGuard_CountsArePerEntityAndPurpose(t *testing.T) {
	svc, id := newPinSvc(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		_ = svc.checkPin(ctx, "parcel", id, "pickup", "1234", "0000", "")
	}
	if err := svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "4821", ""); err != nil {
		t.Fatalf("drop-off must not inherit the pickup lock: %v", err)
	}
	if st, _ := pinStatus(t, svc.checkPin(ctx, "parcel", id, "pickup", "1234", "1234", "")); st != http.StatusTooManyRequests {
		t.Fatalf("pickup should be cooling down, got %d", st)
	}
}

func TestLiveDB_PinGuard_NoPinOnFileNeverMatches(t *testing.T) {
	svc, id := newPinSvc(t)
	if st, _ := pinStatus(t, svc.checkPin(context.Background(), "towing_job", id, "start", "", "", "")); st != http.StatusUnprocessableEntity {
		t.Fatalf("empty expected PIN must not match an empty guess, got %d", st)
	}
}

// Review finding: parallel guesses must not slip past the lock. A burst of 40
// concurrent wrong guesses records exactly pinCooldownEvery failures; every
// other guess is refused by the cooldown without being compared.
func TestLiveDB_PinGuard_ParallelBurstCannotOutrunTheLock(t *testing.T) {
	svc, id := newPinSvc(t)
	ctx := context.Background()
	const burst = 40
	errs := make(chan error, burst)
	for i := 0; i < burst; i++ {
		go func(i int) {
			errs <- svc.checkPin(ctx, "parcel", id, "dropoff", "4821", fmt.Sprintf("%04d", i), "")
		}(i)
	}
	mismatches := 0
	for i := 0; i < burst; i++ {
		if _, code := pinStatus(t, <-errs); code == CodePinMismatch {
			mismatches++
		}
	}
	var failed int
	if err := svc.db.QueryRow(ctx, `SELECT failed_count FROM public.transport_pin_attempts WHERE entity_id=$1`, id).Scan(&failed); err != nil {
		t.Fatal(err)
	}
	if failed != pinCooldownEvery {
		t.Fatalf("a burst of %d recorded %d failures, want exactly %d (the rest refused by the cooldown)", burst, failed, pinCooldownEvery)
	}
	if mismatches > pinCooldownEvery-1 {
		t.Fatalf("%d guesses were compared as plain mismatches, want at most %d", mismatches, pinCooldownEvery-1)
	}
}

// Support can lift a hard lock (the courier may lock their own job on
// purpose); the reset is audited with the cleared record and the reason.
func TestLiveDB_PinGuard_AdminResetLiftsAHardLockAndIsAudited(t *testing.T) {
	svc, id := newPinSvc(t)
	ctx := context.Background()
	admin := NewAdminService(svc)
	adminID := uuid.NewString()
	t.Cleanup(func() {
		_, _ = svc.db.Exec(context.Background(), `DELETE FROM transport_audit_log WHERE entity_type='pin_attempts' AND entity_id LIKE $1`, "%"+id+"%")
	})
	for i := 0; i < pinHardLockAt; i++ {
		_ = svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "9999", "")
		_, _ = svc.db.Exec(ctx, `UPDATE public.transport_pin_attempts SET locked_until=NULL WHERE entity_id=$1`, id)
	}
	if st, _ := pinStatus(t, svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "4821", "")); st != http.StatusLocked {
		t.Fatalf("precondition: want hard-locked (423), got %d", st)
	}

	req := PinAttemptsResetRequest{EntityType: "parcel", EntityID: id, Purpose: "dropoff"}
	if st, _ := pinStatus(t, admin.ResetPinAttempts(ctx, adminID, req)); st != http.StatusBadRequest {
		t.Fatalf("a reset without a reason must be 400, got %d", st)
	}
	req.Reason = "receiver confirmed by phone; courier mistyped"
	if err := admin.ResetPinAttempts(ctx, adminID, req); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if err := svc.checkPin(ctx, "parcel", id, "dropoff", "4821", "4821", ""); err != nil {
		t.Fatalf("after the reset the right PIN must pass: %v", err)
	}
	var reason string
	var hadHard bool
	if err := svc.db.QueryRow(ctx, `SELECT reason, (old_value->>'hardLocked')::boolean FROM transport_audit_log
		WHERE action='pin_attempts.reset' AND entity_id=$1`, "parcel:"+id+":dropoff").Scan(&reason, &hadHard); err != nil {
		t.Fatalf("audit row: %v", err)
	}
	if reason != req.Reason || !hadHard {
		t.Fatalf("audit reason=%q hardLocked=%t", reason, hadHard)
	}
	if st, _ := pinStatus(t, admin.ResetPinAttempts(ctx, adminID, req)); st != http.StatusNotFound {
		t.Fatalf("resetting a hand-off with no record must be 404, got %d", st)
	}
}
