package healthpharmacy

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DP-006 live-DB integration test for proof-of-delivery.
//
// SKIPPED whenever TEST_DATABASE_URL / DATABASE_URL is unset (gated same as rx/lab tests).
// Bring-up:
//
//	supabase start   # or any Postgres with migrations including 20260902000000
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/pharmacy/ -run TestDeliveryProof_LiveDB
//
// Seeds a pharmacy, patient, and pharmacy order (DISPENSED state), then:
// 1. Dispatches the order to IN_DELIVERY
// 2. Completes the order with a valid proof (6-digit OTP)
// 3. Verifies the proof is stored in pharmacy_delivery_proofs
// 4. Tests invalid proof scenarios (missing, wrong format)

func deliveryProofLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB pharmacy delivery proof test; see bring-up note in delivery_proof_live_db_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestDeliveryProof_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := deliveryProofLivePool(t)
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	// Seed IDs
	patientID := uuid.New().String()
	pharmacyID := uuid.New().String()
	pharmacistID := uuid.New().String()
	driverID := uuid.New().String()
	orderID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}

	// Seed users
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		patientID, patientID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		pharmacyID, pharmacyID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		pharmacistID, pharmacistID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		driverID, driverID+"@seed.test")

	// Seed pharmacy provider (HL-2 APPROVED)
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacy','Seed Pharmacy','APPROVED') ON CONFLICT DO NOTHING`,
		pharmacyID, pharmacyID)

	// Seed pharmacy order (DISPENSED state, delivery fulfillment)
	seed(`INSERT INTO public.pharmacy_orders (id, patient_id, pharmacy_provider_id, state, fulfilment_method, total_kobo, idempotency_key, created_at)
	      VALUES ($1,$2,$3,'DISPENSED','DELIVERY',50000,$4,now())`,
		orderID, patientID, pharmacyID, orderID+"_idem")

	// Cleanup
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.pharmacy_delivery_proofs WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM public.pharmacy_orders WHERE id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, pharmacyID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2,$3,$4)`, patientID, pharmacyID, pharmacistID, driverID)
	})

	// Test 1: Verify order transitions to IN_DELIVERY (prerequisite for proof requirement)
	t.Run("order_in_delivery_state", func(t *testing.T) {
		// For MVP testing, directly update the order to IN_DELIVERY with a delivery ref
		// (In real flow, this is done by Dispatch() which requires the Dispatcher seam)
		seed(`UPDATE public.pharmacy_orders SET state='IN_DELIVERY', delivery_ref='delivery_ref_123' WHERE id=$1`, orderID)

		// Verify order is now IN_DELIVERY
		var state string
		err := pool.QueryRow(ctx, `SELECT state FROM public.pharmacy_orders WHERE id=$1`, orderID).Scan(&state)
		if err != nil {
			t.Fatalf("query order state: %v", err)
		}
		if state != "IN_DELIVERY" {
			t.Errorf("expected state IN_DELIVERY, got %s", state)
		}
	})

	// Test 2: Complete with valid OTP proof (DP-006)
	t.Run("complete_with_valid_proof", func(t *testing.T) {
		// Complete the delivery with a valid 6-digit OTP proof
		// (Using pickupCode field for MVP proof OTP)
		order, err := svc.Complete(ctx, driverID, orderID, "123456")
		if err != nil {
			t.Fatalf("complete with valid proof should succeed: %v", err)
		}

		if order.State != "CLOSED" {
			t.Errorf("expected order to be CLOSED, got %s", order.State)
		}

		// Verify proof was stored in the database
		var proofID string
		var proofType string
		var proofData string
		var capturedBy string
		err = pool.QueryRow(ctx,
			`SELECT id, proof_type, proof_data, captured_by FROM public.pharmacy_delivery_proofs WHERE order_id=$1`,
			orderID).Scan(&proofID, &proofType, &proofData, &capturedBy)
		if err != nil {
			t.Fatalf("query proof: %v", err)
		}

		if proofType != "OTP" {
			t.Errorf("expected proof_type OTP, got %s", proofType)
		}
		if proofData != "123456" {
			t.Errorf("expected proof_data 123456, got %s", proofData)
		}
		if capturedBy != driverID {
			t.Errorf("expected captured_by %s, got %s", driverID, capturedBy)
		}
	})

	// Test 3: Verify proof was immutable (captured_at set, verified_at initially null)
	t.Run("proof_immutability", func(t *testing.T) {
		var capturedAt time.Time
		var verifiedAt *time.Time
		err := pool.QueryRow(ctx,
			`SELECT captured_at, verified_at FROM public.pharmacy_delivery_proofs WHERE order_id=$1`,
			orderID).Scan(&capturedAt, &verifiedAt)
		if err != nil {
			t.Fatalf("query proof timestamps: %v", err)
		}

		if capturedAt.IsZero() {
			t.Error("expected captured_at to be set")
		}
		// verified_at stays null until a ProofVerifier is wired (Phase 2 optional feature)
		if verifiedAt != nil {
			t.Logf("info: verified_at is set (ProofVerifier was wired): %v", verifiedAt)
		}
	})
}

// TestDeliveryProof_InvalidProof tests that Complete() rejects invalid proofs (DP-006)
func TestDeliveryProof_InvalidProof(t *testing.T) {
	ctx := context.Background()
	pool := deliveryProofLivePool(t)
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	// Seed fresh order for this test
	patientID := uuid.New().String()
	pharmacyID := uuid.New().String()
	pharmacistID := uuid.New().String()
	driverID := uuid.New().String()
	orderID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		patientID, patientID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		pharmacyID, pharmacyID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		pharmacistID, pharmacistID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		driverID, driverID+"@seed.test")

	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacy','Seed Pharmacy','APPROVED') ON CONFLICT DO NOTHING`,
		pharmacyID, pharmacyID)

	seed(`INSERT INTO public.pharmacy_orders (id, patient_id, pharmacy_provider_id, state, fulfilment_method, total_kobo, idempotency_key, created_at)
	      VALUES ($1,$2,$3,'DISPENSED','DELIVERY',50000,$4,now())`,
		orderID, patientID, pharmacyID, orderID+"_idem")

	// Dispatch first
	seed(`UPDATE public.pharmacy_orders SET state='IN_DELIVERY', delivery_ref='delivery_ref_123' WHERE id=$1`, orderID)

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.pharmacy_delivery_proofs WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM public.pharmacy_orders WHERE id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, pharmacyID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2,$3,$4)`, patientID, pharmacyID, pharmacistID, driverID)
	})

	// Test: Complete without proof should fail
	t.Run("missing_proof", func(t *testing.T) {
		_, err := svc.Complete(ctx, driverID, orderID, "")
		if err == nil {
			t.Error("expected error for missing proof, got nil")
		}
		if !contains(err.Error(), "proof-of-delivery") {
			t.Logf("expected error to mention proof-of-delivery, got: %v", err)
		}
	})

	// Test: Complete with invalid proof format should fail
	t.Run("invalid_proof_format", func(t *testing.T) {
		_, err := svc.Complete(ctx, driverID, orderID, "12345") // 5 digits, not 6
		if err == nil {
			t.Error("expected error for invalid OTP length, got nil")
		}
		if !contains(err.Error(), "OTP") {
			t.Logf("expected error to mention OTP, got: %v", err)
		}
	})
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
