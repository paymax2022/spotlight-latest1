package healthlab

// ---------------------------------------------------------------------------
// LIVE-DB regression coverage for two defects found live during Laboratory
// (Module 16) UAT, both in Handover (chain-of-custody phlebotomist → courier
// handoff, HL-6):
//
//   - allowedSampleTransitions had no SampleCollected -> SampleHandedOver
//     edge, even though Handover's own switch treats SampleCollected as a
//     valid starting state. Every handover call failed with "illegal sample
//     transition COLLECTED -> HANDED_OVER", regardless of caller — the
//     standard courier handover step was completely unreachable.
//   - Handover had no actor/role gate at all, unlike every other
//     custody-mutating action in this package (Collect, Accession): any
//     authenticated caller, including the order's own patient, could
//     reassign chain-of-custody to an arbitrary custodian.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
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
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// fakeHandoverGate is a minimal ProviderGate test double: it reports the
// configured phlebotomist as verified for the configured lab and denies
// everyone else, so the test can prove BOTH the allow and deny paths without
// seeding real health_provider capability rows.
type fakeHandoverGate struct {
	labID, verifiedPhlebotomistID string
}

func (g fakeHandoverGate) IsApprovedLab(ctx context.Context, providerID string) (bool, error) {
	return providerID == g.labID, nil
}
func (g fakeHandoverGate) VerifiedLabOwner(ctx context.Context, userID, providerID string) (bool, error) {
	return false, nil
}
func (g fakeHandoverGate) IsVerifiedScientist(ctx context.Context, userID, providerID string) (bool, error) {
	return false, nil
}
func (g fakeHandoverGate) IsVerifiedPhlebotomist(ctx context.Context, userID, providerID string) (bool, error) {
	return providerID == g.labID && userID == g.verifiedPhlebotomistID, nil
}

func seedHandoverFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (labID, orderID, sampleID, phleboID, strangerID, patientID string) {
	t.Helper()
	ownerID := uuid.New().String()
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
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM lab_custody_events WHERE sample_id=$1`, sampleID)
		pool.Exec(bg, `DELETE FROM lab_samples WHERE id=$1`, sampleID)
		pool.Exec(bg, `DELETE FROM lab_orders WHERE id=$1`, orderID)
		pool.Exec(bg, `DELETE FROM health_providers WHERE id=$1`, labID)
	})
	return
}

// TestLiveDB_Handover_CollectedToHandedOverSucceeds locks the transition-map
// fix: a COLLECTED sample must be able to reach HANDED_OVER via a verified
// phlebotomist of the owning lab.
func TestLiveDB_Handover_CollectedToHandedOverSucceeds(t *testing.T) {
	pool := handoverPool(t)
	ctx := context.Background()
	labID, _, sampleID, phleboID, _, _ := seedHandoverFixture(t, ctx, pool)

	svc := NewService(pool, nil, nil, fakeHandoverGate{labID: labID, verifiedPhlebotomistID: phleboID}, nil, nil, nil, nil)

	out, err := svc.Handover(ctx, phleboID, sampleID, "", "courier pickup")
	if err != nil {
		t.Fatalf("Handover(COLLECTED -> HANDED_OVER) by a verified phlebotomist must succeed: %v", err)
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

// TestLiveDB_Handover_RejectsCallerWithoutPhlebotomistCredential locks the
// authz fix: a caller who is not a verified phlebotomist of the sample's
// owning lab — including the order's own patient, or an unrelated stranger —
// must be refused, never allowed to reassign custody.
func TestLiveDB_Handover_RejectsCallerWithoutPhlebotomistCredential(t *testing.T) {
	pool := handoverPool(t)
	ctx := context.Background()
	labID, _, sampleID, phleboID, strangerID, patientID := seedHandoverFixture(t, ctx, pool)

	svc := NewService(pool, nil, nil, fakeHandoverGate{labID: labID, verifiedPhlebotomistID: phleboID}, nil, nil, nil, nil)

	for name, actor := range map[string]string{"stranger": strangerID, "patient": patientID} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.Handover(ctx, actor, sampleID, "", "unauthorized attempt"); err == nil {
				t.Fatalf("Handover by %s (not a verified phlebotomist) must be refused, got nil error", name)
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
