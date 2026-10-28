package portal

// LIVE-DB tests for the provider-portal capabilities read. Skip unless
// TEST_DATABASE_URL is set.

import (
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping provider-portal live-DB tests")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(t.Context(), `INSERT INTO auth.users (id, email) VALUES ($1,$2)`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func seedHealthProvider(t *testing.T, pool *pgxpool.Pool, owner, domain, ptype, name, status string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, owner, domain, ptype, name, status); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	return id
}

func TestLiveDB_Capabilities_OnlyTheCallersOwnRecords(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	alice, bob := seedUser(t, pool), seedUser(t, pool)

	vet := seedHealthProvider(t, pool, alice, "VET", "vet", "Alice Vet", "APPROVED")
	seedHealthProvider(t, pool, bob, "PHARMACY", "pharmacy", "Bob Pharmacy", "APPROVED")

	got, err := Capabilities(ctx, pool, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Type != "vet" || got[0].ProviderID != vet || !got[0].Approved {
		t.Fatalf("alice capabilities = %+v, want exactly her approved vet record", got)
	}
}

func TestLiveDB_Capabilities_NonProviderGetsEmptyNotNil(t *testing.T) {
	pool := livePool(t)
	got, err := Capabilities(t.Context(), pool, seedUser(t, pool))
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("non-provider capabilities = %#v, want empty non-nil slice", got)
	}
}

func TestLiveDB_Capabilities_PendingAndSuspendedAreNotApproved(t *testing.T) {
	pool := livePool(t)
	u := seedUser(t, pool)
	seedHealthProvider(t, pool, u, "LAB", "lab", "Pending Lab", "PENDING")
	seedHealthProvider(t, pool, u, "PHARMACY", "pharmacy", "Suspended Pharm", "SUSPENDED")

	got, err := Capabilities(t.Context(), pool, u)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("capabilities = %+v, want 2 records", got)
	}
	for _, c := range got {
		if c.Approved {
			t.Fatalf("%s %s must not be approved", c.Type, c.Status)
		}
	}
}

func TestLiveDB_Capabilities_DoctorMapsFromVerification(t *testing.T) {
	pool := livePool(t)
	u := seedUser(t, pool)
	if _, err := pool.Exec(t.Context(),
		`INSERT INTO doctor_profiles (user_id, name, verification) VALUES ($1,'Dr Test','approved')`, u); err != nil {
		t.Fatalf("seed doctor: %v", err)
	}
	got, err := Capabilities(t.Context(), pool, u)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Type != "doctor" || !got[0].Approved || got[0].DisplayName != "Dr Test" {
		t.Fatalf("doctor capabilities = %+v", got)
	}
}

func TestLiveDB_Capabilities_StaffRowsAreNotABusiness(t *testing.T) {
	pool := livePool(t)
	u := seedUser(t, pool)
	seedHealthProvider(t, pool, u, "PHARMACY", "pharmacist", "Staff Pharmacist", "APPROVED")
	seedHealthProvider(t, pool, u, "LAB", "phlebotomist", "Staff Phleb", "APPROVED")

	got, err := Capabilities(t.Context(), pool, u)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("staff-type rows must not open an owner portal, got %+v", got)
	}
}
