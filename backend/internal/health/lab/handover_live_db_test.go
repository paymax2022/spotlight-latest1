package healthlab

// LIVE-DB regression coverage for two defects found live during Laboratory
// (Module 16) UAT, both in Handover (chain-of-custody phlebotomist → courier
// handoff, HL-6):
//   - allowedSampleTransitions had no SampleCollected -> SampleHandedOver
//     edge, even though Handover's own switch treats SampleCollected as a
//     valid starting state. Every handover call failed with "illegal sample
//     transition COLLECTED -> HANDED_OVER", regardless of caller — the
//     standard courier handover step was completely unreachable.
//   - Handover had no actor/role gate at all, unlike every other
//     custody-mutating action in this package (Collect, Accession): any
//     authenticated caller, including the order's own patient, could
//     reassign chain-of-custody to an arbitrary custodian.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func handoverPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping lab handover live-DB tests")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// fakeHandoverGate is a minimal ProviderGate test double: under the interim
// staff-affiliation gate (isLabStaff — a lab_scientist/phlebotomist capability
// row is self-owned and names no employing lab) the ONLY actor that passes
// the staff check is the lab's verified owner. The seeded phlebotomist user
// is therefore a capability-holding stranger whose denial is asserted below.
type fakeHandoverGate struct {
	labID, ownerID string
}

func (g fakeHandoverGate) IsApprovedLab(ctx context.Context, providerID string) (bool, error) {
	return providerID == g.labID, nil
}
func (g fakeHandoverGate) VerifiedLabOwner(ctx context.Context, userID, providerID string) (bool, error) {
	return providerID == g.labID && userID == g.ownerID, nil
}
func (g fakeHandoverGate) IsVerifiedScientist(ctx context.Context, userID, providerID string) (bool, error) {
	return false, nil
}
func (g fakeHandoverGate) IsVerifiedPhlebotomist(ctx context.Context, userID, providerID string) (bool, error) {
	return false, nil
}

func seedHandoverFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (labID, ownerID, orderID, sampleID, phleboID, strangerID, patientID string) {
	t.Helper()
	ownerID = uuid.New().String()
	patientID = uuid.New().String()
	phleboID = uuid.New().String()
	strangerID = uuid.New().String()
	for _, u := range []string{ownerID, patientID, phleboID, strangerID} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	labID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'LAB','lab','Handover UAT Lab','APPROVED')`, labID, ownerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	orderID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, idempotency_key)
		 VALUES ($1,$2,$3,'SCHEDULED','HOME',150000,$4)`,
		orderID, patientID, labID, "idem-handover-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	sampleID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_samples (id, order_id, state, collection_method, barcode_ref, collected_by)
		 VALUES ($1,$2,'COLLECTED','HOME','BC-HANDOVER-UAT',$3)`,
		sampleID, orderID, phleboID); err != nil {
		t.Fatalf("seed sample: %v", err)
	}
	t.Cleanup(func() {
		bg := t.Context()
		_, _ = pool.Exec(bg, `DELETE FROM lab_custody_events WHERE sample_id=$1`, sampleID)
		_, _ = pool.Exec(bg, `DELETE FROM lab_samples WHERE id=$1`, sampleID)
		_, _ = pool.Exec(bg, `DELETE FROM lab_orders WHERE id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM health_providers WHERE id=$1`, labID)
	})
	return labID, ownerID, orderID, sampleID, phleboID, strangerID, patientID
}

// TestLiveDB_Handover_CollectedToHandedOverSucceeds locks the transition-map
// fix: a COLLECTED sample must be able to reach HANDED_OVER — under the
// interim staff-affiliation gate via the lab's verified owner (see isLabStaff).
func TestLiveDB_Handover_CollectedToHandedOverSucceeds(t *testing.T) {
	pool := handoverPool(t)
	ctx := t.Context()
	labID, ownerID, _, sampleID, _, _, _ := seedHandoverFixture(t, ctx, pool) //nolint:dogsled // tuple: subset needed

	svc := NewService(pool, nil, nil, fakeHandoverGate{labID: labID, ownerID: ownerID}, nil, nil, nil, nil)

	out, err := svc.Handover(ctx, ownerID, sampleID, "", "courier pickup")
	if err != nil {
		t.Fatalf("Handover(COLLECTED -> HANDED_OVER) by the verified lab owner must succeed: %v", err)
	}
	if out.State != SampleHandedOver {
		t.Fatalf("sample state = %s, want %s", out.State, SampleHandedOver)
	}

	var dbState string
	if err := pool.QueryRow(ctx, `SELECT state FROM lab_samples WHERE id=$1`, sampleID).Scan(&dbState); err != nil {
		t.Fatalf("read sample state: %v", err)
	}
	if dbState != string(SampleHandedOver) {
		t.Fatalf("db sample state = %s, want %s", dbState, SampleHandedOver)
	}
}

// TestLiveDB_Handover_RejectsCallerWithoutLabStaffGate locks the authz fix:
// a caller who is not verified staff of the sample's owning lab — including
// the order's own patient, an unrelated stranger, or a standalone
// phlebotomist capability holder (who owns no affiliation to THIS lab under
// the interim gate) — must be refused with the uniform not-found sentinel,
// never allowed to reassign custody.
func TestLiveDB_Handover_RejectsCallerWithoutLabStaffGate(t *testing.T) {
	pool := handoverPool(t)
	ctx := t.Context()
	labID, ownerID, _, sampleID, phleboID, strangerID, patientID := seedHandoverFixture(t, ctx, pool)

	svc := NewService(pool, nil, nil, fakeHandoverGate{labID: labID, ownerID: ownerID}, nil, nil, nil, nil)

	for name, actor := range map[string]string{"stranger": strangerID, "patient": patientID, "foreign_phlebotomist": phleboID} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.Handover(ctx, actor, sampleID, "", "unauthorized attempt"); !errors.Is(err, ErrOrderNotFound) {
				t.Fatalf("Handover by %s must be refused with ErrOrderNotFound, got %v", name, err)
			}
		})
	}

	// Confirm neither unauthorized attempt actually mutated custody.
	var dbState string
	if err := pool.QueryRow(ctx, `SELECT state FROM lab_samples WHERE id=$1`, sampleID).Scan(&dbState); err != nil {
		t.Fatalf("read sample state: %v", err)
	}
	if dbState != string(SampleCollected) {
		t.Fatalf("sample state = %s after refused handover attempts, want unchanged %s", dbState, SampleCollected)
	}
	var custodyCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM lab_custody_events WHERE sample_id=$1`, sampleID).Scan(&custodyCount); err != nil {
		t.Fatalf("count custody events: %v", err)
	}
	if custodyCount != 0 {
		t.Fatalf("custody_events count = %d after refused handover attempts, want 0", custodyCount)
	}
}
