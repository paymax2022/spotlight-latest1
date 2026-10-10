package healthpharmacy_test

// LIVE-DB regression for the security re-audit R3: the six-digit pickup /
// delivery-confirmation code is the credential completing an order AND the
// pharmacy owner (a legitimate completing party) is the escrow payee, so an
// uncapped mismatch-and-retry path was an online brute force to self-release
// the patient's hold. verifyFulfilmentCode now counts failed comparisons per
// order and locks completion after five — a locked order refuses every
// further presentation, even the correct code. Skips unless TEST_DATABASE_URL
// is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"
)

func TestLiveDB_Complete_PickupCodeAttemptLockout(t *testing.T) {
	pool := stockDispatchPool(t)
	ctx := context.Background()
	patientID, pharmacyID, _ := seedStockFixture(t, ctx, pool, 0)

	svc := healthpharmacy.NewService(pool, nil, nil, nil, nil, testProviderGate{pharmacyID: pharmacyID}, nil, nil)

	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO pharmacy_orders
			(id, patient_id, pharmacy_provider_id, state, fulfilment_method, total_kobo, pickup_code, idempotency_key)
		VALUES ($1,$2,$3,'READY_FOR_PICKUP','PICKUP',100000,'123456',$4)`,
		orderID, patientID, pharmacyID, "idem-lockout-"+orderID); err != nil {
		t.Fatalf("seed pickup order: %v", err)
	}

	// The pharmacy owner is a legitimate completing party (authorizeOrderParty
	// via testProviderGate) — and the escrow payee, the actor this cap exists
	// for.
	ownerActor := "owner-actor-" + uuid.New().String()

	// Five wrong guesses: attempts 1-4 report the ordinary mismatch; the 5th
	// burns the credential — the order is locked from that point on.
	for i := 1; i <= 5; i++ {
		_, err := svc.Complete(ctx, ownerActor, orderID, "99999"+string(rune('0'+i)))
		if err == nil {
			t.Fatalf("attempt %d: wrong code must not complete", i)
		}
		if i < 5 && errors.Is(err, healthpharmacy.ErrFulfilmentLocked) {
			t.Fatalf("attempt %d: locked too early — want plain mismatch", i)
		}
		if i == 5 && !errors.Is(err, healthpharmacy.ErrFulfilmentLocked) {
			t.Fatalf("attempt 5 must lock: got %v", err)
		}
	}

	// Correct code on a locked order is still refused — the credential is
	// burned; support or a dispute resolves the order from here.
	if _, err := svc.Complete(ctx, ownerActor, orderID, "123456"); !errors.Is(err, healthpharmacy.ErrFulfilmentLocked) {
		t.Fatalf("locked order must refuse even the correct code: %v", err)
	}

	var attempts int
	var locked bool
	if err := pool.QueryRow(ctx,
		`SELECT pickup_attempts, pickup_locked FROM pharmacy_orders WHERE id=$1`, orderID).
		Scan(&attempts, &locked); err != nil {
		t.Fatalf("read counters: %v", err)
	}
	if !locked || attempts != 5 {
		t.Fatalf("pickup_attempts=%d locked=%v, want 5/true (a correct code on a locked order must not count)", attempts, locked)
	}

	// State untouched — a brute-forced order never left READY_FOR_PICKUP.
	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM pharmacy_orders WHERE id=$1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "READY_FOR_PICKUP" {
		t.Fatalf("order state = %s, want READY_FOR_PICKUP", state)
	}
}

// TestLiveDB_Complete_CorrectCodeNoAttemptsBurned proves the legitimate path:
// the right code completes and consumes no budget.
func TestLiveDB_Complete_CorrectCodeNoAttemptsBurned(t *testing.T) {
	pool := stockDispatchPool(t)
	ctx := context.Background()
	patientID, pharmacyID, _ := seedStockFixture(t, ctx, pool, 0)

	svc := healthpharmacy.NewService(pool, nil, nil, nil, nil, testProviderGate{pharmacyID: pharmacyID}, nil, nil)

	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO pharmacy_orders
			(id, patient_id, pharmacy_provider_id, state, fulfilment_method, total_kobo, pickup_code, idempotency_key)
		VALUES ($1,$2,$3,'READY_FOR_PICKUP','PICKUP',100000,'654321',$4)`,
		orderID, patientID, pharmacyID, "idem-ok-"+orderID); err != nil {
		t.Fatalf("seed pickup order: %v", err)
	}

	// The patient completes with their own code.
	got, err := svc.Complete(ctx, patientID, orderID, "654321")
	if err != nil {
		t.Fatalf("correct code must complete: %v", err)
	}
	if got == nil || got.State != healthpharmacy.StateClosed {
		if got != nil {
			t.Fatalf("completed order state = %s, want CLOSED", got.State)
		}
		t.Fatal("nil order on success")
	}

	var attempts int
	var locked bool
	if err := pool.QueryRow(ctx,
		`SELECT pickup_attempts, pickup_locked FROM pharmacy_orders WHERE id=$1`, orderID).
		Scan(&attempts, &locked); err != nil {
		t.Fatalf("read counters: %v", err)
	}
	if attempts != 0 || locked {
		t.Fatalf("legitimate completion burned budget: attempts=%d locked=%v", attempts, locked)
	}
}
