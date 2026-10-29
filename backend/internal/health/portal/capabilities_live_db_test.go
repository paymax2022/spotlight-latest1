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

func seedRestaurant(t *testing.T, pool *pgxpool.Pool, owner, name, kybStatus string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO restaurants (id, owner_id, name, address) VALUES ($1,$2,$3,'1 Test Street')`,
		id, owner, name); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	if kybStatus != "" {
		if _, err := pool.Exec(t.Context(), `
			INSERT INTO restaurant_kyb (restaurant_id, status) VALUES ($1,$2)`, id, kybStatus); err != nil {
			t.Fatalf("seed kyb: %v", err)
		}
	}
	return id
}

func TestLiveDB_Capabilities_RestaurantApprovalFollowsKYB(t *testing.T) {
	pool := livePool(t)
	alice, bob := seedUser(t, pool), seedUser(t, pool)

	approved := seedRestaurant(t, pool, alice, "Alice Kitchen", "approved")
	submitted := seedRestaurant(t, pool, bob, "Bob Kitchen", "submitted")

	got, err := Capabilities(t.Context(), pool, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Type != "restaurant" || got[0].ProviderID != approved || !got[0].Approved {
		t.Fatalf("alice = %+v, want her approved restaurant only", got)
	}

	got, err = Capabilities(t.Context(), pool, bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ProviderID != submitted || got[0].Approved || got[0].Status != "SUBMITTED" {
		t.Fatalf("bob = %+v, want his submitted restaurant held as pending", got)
	}
}

func TestLiveDB_Capabilities_ExtendedTypesAreOwnerScoped(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	alice, bob := seedUser(t, pool), seedUser(t, pool)

	if _, err := pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'Alice Estate',$2)`, uuid.NewString(), alice); err != nil {
		t.Fatalf("seed estate: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO assoc_organisations (id, name, category, created_by) VALUES ($1,'Alice Assoc','professional',$2)`, uuid.NewString(), alice); err != nil {
		t.Fatalf("seed association: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO campaigns (id, creator_id, title, goal_kobo, deadline) VALUES ($1,$2,'Alice Campaign',100000, now() + interval '30 days')`, uuid.NewString(), alice); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO bus_providers (id, owner_user_id, business_name, contact_phone, verification_status) VALUES ($1,$2,'Alice Coaches','08000000000','pending')`, uuid.NewString(), alice); err != nil {
		t.Fatalf("seed bus provider: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO campaigns (id, creator_id, title, goal_kobo, deadline) VALUES ($1,$2,'Bob Campaign',100000, now() + interval '30 days')`, uuid.NewString(), bob); err != nil {
		t.Fatalf("seed bob campaign: %v", err)
	}

	got, err := Capabilities(ctx, pool, alice)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]Capability{}
	for _, c := range got {
		seen[c.Type] = c
	}
	if seen["estate_manager"].DisplayName != "Alice Estate" || !seen["estate_manager"].Approved {
		t.Fatalf("estate = %+v", seen["estate_manager"])
	}
	if seen["association_creator"].DisplayName != "Alice Assoc" {
		t.Fatalf("association = %+v", seen["association_creator"])
	}
	if seen["crowdfunding_creator"].DisplayName != "Alice Campaign" {
		t.Fatalf("campaign = %+v", seen["crowdfunding_creator"])
	}
	if b, ok := seen["bus_owner"]; !ok || b.Approved || b.Status != "PENDING" {
		t.Fatalf("bus = %+v, want pending and not approved", b)
	}
	for _, c := range got {
		if c.DisplayName == "Bob Campaign" {
			t.Fatalf("alice sees bob's campaign: %+v", c)
		}
	}
}

func TestLiveDB_Capabilities_DriverApprovalFollowsVerification(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	alice, bob := seedUser(t, pool), seedUser(t, pool)

	if _, err := pool.Exec(ctx, `INSERT INTO drivers (user_id, name, vehicle_reg, verification_status) VALUES ($1,'Alice Rider','AA-111',$2)`, alice, "approved"); err != nil {
		t.Fatalf("seed driver: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO drivers (user_id, name, vehicle_reg, verification_status) VALUES ($1,'Bob Rider','BB-222',$2)`, bob, "draft"); err != nil {
		t.Fatalf("seed bob driver: %v", err)
	}

	// One drivers row is both the mobility driver and the delivery rider console,
	// so it yields exactly those two capabilities with the row's approval state.
	capsByType := func(caps []Capability) map[string]Capability {
		m := map[string]Capability{}
		for _, c := range caps {
			m[c.Type] = c
		}
		return m
	}

	got, err := Capabilities(ctx, pool, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("alice = %+v, want driver + rider", got)
	}
	seen := capsByType(got)
	for _, typ := range []string{"driver", "rider"} {
		if c, ok := seen[typ]; !ok || !c.Approved || c.Status != "APPROVED" {
			t.Fatalf("alice %s = %+v, want approved", typ, seen[typ])
		}
	}

	got, err = Capabilities(ctx, pool, bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("bob = %+v, want driver + rider held as pending", got)
	}
	seen = capsByType(got)
	for _, typ := range []string{"driver", "rider"} {
		if c, ok := seen[typ]; !ok || c.Approved || c.Status != "DRAFT" {
			t.Fatalf("bob %s = %+v, want draft held as pending", typ, seen[typ])
		}
	}
}
