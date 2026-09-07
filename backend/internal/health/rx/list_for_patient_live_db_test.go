package healthrx

// Live-DB regression: GET /health/pharmacy/prescriptions (the pharmacy
// vertical's "My Prescriptions" list) had no route/handler/service method at
// all — only the single-item GET /prescriptions/:id existed, which needs an
// id the patient doesn't have on first load. This pins ListForPatient, the
// service method the new route calls through the pharmacy RxLister seam
// (see healthpharmacy.RxLister / internal/app/health_pharmacy_routes.go's
// rxListerAdapter).
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func rxListLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping rx ListForPatient live-DB tests")
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

func seedRxTestUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user %s: %v", id, err)
	}
	testsupport.CleanupUser(t, pool, id)
}

func TestLiveDB_ListForPatient_ScopedToCallerWithItems(t *testing.T) {
	pool := rxListLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)

	patient := uuid.New().String()
	other := uuid.New().String()
	prescriber := uuid.New().String()
	seedRxTestUser(t, ctx, pool, patient)
	seedRxTestUser(t, ctx, pool, other)
	seedRxTestUser(t, ctx, pool, prescriber)

	mine, err := svc.Issue(ctx, prescriber, patient, nil, []Item{
		{DrugName: "Amoxicillin", NAFDACRef: "NAF-001", Dosage: "500mg twice daily", Quantity: 14},
	})
	if err != nil {
		t.Fatalf("issue mine: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM health_prescription_items WHERE prescription_id=$1`, mine.ID)
		pool.Exec(context.Background(), `DELETE FROM health_prescriptions WHERE id=$1`, mine.ID)
	})

	notMine, err := svc.Issue(ctx, prescriber, other, nil, []Item{
		{DrugName: "Paracetamol", NAFDACRef: "NAF-002", Dosage: "1g as needed", Quantity: 20},
	})
	if err != nil {
		t.Fatalf("issue not-mine: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM health_prescription_items WHERE prescription_id=$1`, notMine.ID)
		pool.Exec(context.Background(), `DELETE FROM health_prescriptions WHERE id=$1`, notMine.ID)
	})

	got, err := svc.ListForPatient(ctx, patient)
	if err != nil {
		t.Fatalf("ListForPatient: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d prescriptions, want exactly 1 (the caller's own)", len(got))
	}
	if got[0].ID != mine.ID {
		t.Errorf("returned prescription %s, want the caller's own %s", got[0].ID, mine.ID)
	}
	if len(got[0].Items) != 1 || got[0].Items[0].DrugName != "Amoxicillin" {
		t.Errorf("Items = %+v, want the one seeded item attached", got[0].Items)
	}
}

func TestLiveDB_ListForPatient_EmptyIsEmptyNotNil(t *testing.T) {
	pool := rxListLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)

	got, err := svc.ListForPatient(ctx, uuid.New().String())
	if err != nil {
		t.Fatalf("ListForPatient: %v", err)
	}
	if got == nil {
		t.Error("got nil slice, want a non-nil empty slice so the handler serialises [] rather than null")
	}
	if len(got) != 0 {
		t.Errorf("got %d prescriptions for a brand-new patient id, want 0", len(got))
	}
}
