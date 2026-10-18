package transport

// LIVE-DB tests for the hand-off PIN attempt guard (checkPin). Skipped unless
// TEST_DATABASE_URL is set. Pins the brute-force fix: a 4-digit PIN can no
// longer be guessed by scripting the verify endpoint.

import (
	"context"
	"errors"
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
