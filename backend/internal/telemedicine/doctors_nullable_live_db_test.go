package telemedicine_test

// ---------------------------------------------------------------------------
// LIVE-DB regression: a doctor with no `about` (or no `bio`) must not take the
// whole doctor list down.
//
// doctors.about and doctors.bio are NULLABLE text columns read into PLAIN Go
// strings (Doctor.About, Doctor.Bio) — unlike sub_specialty/avatar_url/
// mdcn_number/phone, which are already *string. pgx fails the whole scan on
// either, and because that happens per-row inside the loop, ONE such doctor
// returned 500 for the ENTIRE list. Every doctor in the local database had
// about=NULL, so GET /v1/telemedicine/doctors — the front door of the module —
// was 500 outright while the specialties list beside it worked fine.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/telemedicine"
)

func doctorsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping telemedicine doctors live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestLiveDB_ListDoctors_ToleratesNullBioAndAbout(t *testing.T) {
	pool := doctorsPool(t)
	ctx := context.Background()
	svc := telemedicine.NewService(pool, nil)

	id := uuid.New().String()
	user := uuid.New().String()
	name := "Dr Nulls " + id[:8]
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2) ON CONFLICT DO NOTHING`,
		user, user+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	// bio AND about NULL: the shape every doctor in the local database has.
	if _, err := pool.Exec(ctx,
		`INSERT INTO doctors (id, user_id, name, specialty, bio, about, consult_fee_kobo,
			is_available, is_online, is_hmo_verified, experience_years, rating,
			review_count, patients_count, success_rate, education)
		 VALUES ($1::uuid, $2::uuid, $3, 'general', NULL, NULL, 500000,
			TRUE, FALSE, FALSE, 5, 4.5, 0, 0, 90, '[]'::jsonb)`, id, user, name); err != nil {
		t.Fatalf("seed doctor: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM doctors WHERE id=$1::uuid`, id)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id=$1::uuid`, user)
	})

	docs, err := svc.ListDoctors(ctx, telemedicine.ListDoctorsQuery{Limit: 100})
	if err != nil {
		t.Fatalf("ListDoctors must not fail because a doctor has no bio/about: %v", err)
	}

	var found *telemedicine.Doctor
	for i := range docs {
		if docs[i].ID == id {
			found = &docs[i]
			break
		}
	}
	if found == nil {
		t.Fatal("the doctor is missing from the list — they should be listed, not dropped")
	}
	if found.About != "" {
		t.Errorf("About = %q, want empty string for a NULL column", found.About)
	}
	if found.Bio != "" {
		t.Errorf("Bio = %q, want empty string for a NULL column", found.Bio)
	}

	// GetDoctor shares the column list and had the identical bug.
	one, err := svc.GetDoctor(ctx, id)
	if err != nil {
		t.Fatalf("GetDoctor must not fail on a doctor with NULL bio/about: %v", err)
	}
	if one.About != "" || one.Bio != "" {
		t.Errorf("GetDoctor About=%q Bio=%q, want both empty", one.About, one.Bio)
	}
}
