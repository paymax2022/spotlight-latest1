package healthvet

// ---------------------------------------------------------------------------
// LIVE-DB regression coverage for a defect found live during Veterinary
// (Module 17) UAT: unlike Accept/StartConsult (which correctly re-check
// VerifiedVetOwner/HL-2), Confirm and CompleteConsult never re-verified the
// vet's VCN approval status — a vet accepted while APPROVED and suspended
// before confirming/completing could still advance the appointment and, via
// CompleteConsult, trigger the real escrow release to a non-compliant
// provider. This file locks the Confirm-side fix (the simpler of the two to
// exercise without the consult engine's SOAP-note dependency); the
// CompleteConsult-side fix was live-verified via a full booking-lifecycle
// curl sweep at fix time.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthscheduling "spotlight/backend/internal/health/scheduling"
	"spotlight/backend/internal/scheduler"
)

func vcnGatePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping vet VCN-gate live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// fakeVCNGate is a minimal ProviderGate test double: it reports the
// configured provider as approved/verified only when approved=true, letting
// the test flip the vet's compliance state without a real capability-row
// mutation dance.
type fakeVCNGate struct {
	providerID string
	vetOwnerID string
	approved   bool
}

func (g fakeVCNGate) IsApprovedVet(ctx context.Context, providerID string) (bool, error) {
	return providerID == g.providerID && g.approved, nil
}
func (g fakeVCNGate) VerifiedVetOwner(ctx context.Context, userID, providerID string) (bool, error) {
	return userID == g.vetOwnerID && providerID == g.providerID && g.approved, nil
}

func seedVCNGateFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (providerID, vetOwnerID, apptID string) {
	t.Helper()
	vetOwnerID = uuid.New().String()
	ownerID := uuid.New().String()
	for _, u := range []string{vetOwnerID, ownerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	providerID = seedVetProvider(t, ctx, pool, vetOwnerID)

	petID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO pets (id, owner_user_id, name, species) VALUES ($1,$2,'VCN UAT Pet','dog')`, petID, ownerID); err != nil {
		t.Fatalf("seed pet: %v", err)
	}
	serviceID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO vet_services (id, provider_id, code, name, visit_type, price_kobo, active)
		VALUES ($1,$2,'VCNUAT','VCN UAT Tele Consult','TELE',200000,true)`,
		serviceID, providerID); err != nil {
		t.Fatalf("seed service: %v", err)
	}

	apptID = uuid.New().String()
	slotStart := "now() + interval '1 day'"
	slotEnd := "now() + interval '1 day 1 hour'"
	if _, err := pool.Exec(ctx, `
		INSERT INTO health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
		VALUES ($1,$2,$3,'PET','TELE','ACCEPTED', `+slotStart+`, `+slotEnd+`)`,
		apptID, providerID, ownerID); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO vet_appointment_payments (id, appointment_id, owner_id, provider_id, pet_id, service_id, visit_type, total_kobo, pay_state, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,'TELE',200000,'HELD',$7)`,
		uuid.New().String(), apptID, ownerID, providerID, petID, serviceID, "idem-vcn-"+apptID); err != nil {
		t.Fatalf("seed payment row: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM vet_appointment_payments WHERE appointment_id=$1`, apptID)
		pool.Exec(bg, `DELETE FROM health_appointments WHERE id=$1`, apptID)
		pool.Exec(bg, `DELETE FROM pets WHERE id=$1`, petID)
		pool.Exec(bg, `DELETE FROM vet_services WHERE id=$1`, serviceID)
	})
	return
}

// TestLiveDB_Confirm_RejectsSuspendedVet locks the fix: a vet whose VCN
// approval is no longer valid (simulated here via a ProviderGate reporting
// approved=false) must be refused at Confirm, not just at Accept.
func TestLiveDB_Confirm_RejectsSuspendedVet(t *testing.T) {
	pool := vcnGatePool(t)
	ctx := context.Background()
	sched := scheduler.NewService(pool)
	schedulingSvc := healthscheduling.NewService(pool, sched, nil)

	providerID, vetOwnerID, apptID := seedVCNGateFixture(t, ctx, pool)

	// Suspended: the gate denies.
	svcSuspended := NewService(pool, nil, nil, fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: false}, nil, schedulingSvc, nil, nil, nil, nil, nil)
	if _, err := svcSuspended.Confirm(ctx, vetOwnerID, apptID); err == nil {
		t.Fatal("Confirm by a suspended (non-VCN-approved) vet must be refused, got nil error")
	}
	var dbState string
	if err := pool.QueryRow(ctx, `SELECT state FROM health_appointments WHERE id=$1`, apptID).Scan(&dbState); err != nil {
		t.Fatalf("read appointment state: %v", err)
	}
	if dbState != "ACCEPTED" {
		t.Fatalf("appointment state = %s after refused Confirm, want unchanged ACCEPTED", dbState)
	}
}

// TestLiveDB_Confirm_AllowsApprovedVet is the companion positive case: a
// genuinely approved vet must still be able to confirm normally — the fix
// must not fail closed for legitimate vets.
func TestLiveDB_Confirm_AllowsApprovedVet(t *testing.T) {
	pool := vcnGatePool(t)
	ctx := context.Background()
	sched := scheduler.NewService(pool)
	schedulingSvc := healthscheduling.NewService(pool, sched, nil)

	providerID, vetOwnerID, apptID := seedVCNGateFixture(t, ctx, pool)

	svcApproved := NewService(pool, nil, nil, fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true}, nil, schedulingSvc, nil, nil, nil, nil, nil)
	out, err := svcApproved.Confirm(ctx, vetOwnerID, apptID)
	if err != nil {
		t.Fatalf("Confirm by a genuinely approved vet must succeed: %v", err)
	}
	if out.State != StateConfirmed {
		t.Fatalf("state = %s, want %s", out.State, StateConfirmed)
	}
}

// TestLiveDB_Confirm_OwnerCallerUnaffectedByVCNGate confirms the fix is
// correctly scoped to vet callers only: the PATIENT/owner confirming their
// own appointment must not be subject to a vet-credential check at all (they
// are not a vet).
func TestLiveDB_Confirm_OwnerCallerUnaffectedByVCNGate(t *testing.T) {
	pool := vcnGatePool(t)
	ctx := context.Background()
	sched := scheduler.NewService(pool)
	schedulingSvc := healthscheduling.NewService(pool, sched, nil)

	providerID, vetOwnerID, apptID := seedVCNGateFixture(t, ctx, pool)

	var ownerID string
	if err := pool.QueryRow(ctx, `SELECT owner_id FROM vet_appointment_payments WHERE appointment_id=$1`, apptID).Scan(&ownerID); err != nil {
		t.Fatalf("read owner id: %v", err)
	}

	// Gate reports the vet as suspended, but the CALLER here is the owner,
	// not the vet — the gate must never be consulted for this actor.
	svc := NewService(pool, nil, nil, fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: false}, nil, schedulingSvc, nil, nil, nil, nil, nil)
	if _, err := svc.Confirm(ctx, ownerID, apptID); err != nil {
		t.Fatalf("Confirm by the owner (not a vet) must not be blocked by the vet's VCN gate: %v", err)
	}
}
