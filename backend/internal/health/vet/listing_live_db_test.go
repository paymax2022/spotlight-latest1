package healthvet

// LIVE-DB tests for vet listings: who is shown, the fees and types, and that an
// unlisted vet and a missing one answer the same. Skip unless TEST_DATABASE_URL
// is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedVetListing creates a provider row and a profile for one owner. The profile
// is published and approved unless overridden, so each case changes one thing.
func seedVetListing(t *testing.T, ctx context.Context, pool *pgxpool.Pool, owner, name string, discoverable bool, providerStatus, verification string, published bool) string {
	t.Helper()
	seedVetTestUser(t, ctx, pool, owner)
	providerID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status, discoverable, geo)
		VALUES ($1,$2,'VET','vet',$3,$4,$5, ST_SetSRID(ST_MakePoint(3.40,6.43),4326)::geography)`,
		providerID, owner, name, providerStatus, discoverable); err != nil {
		t.Fatalf("provider: %v", err)
	}
	draft := `{"draft":{"personalInfo":{"title":"Dr.","firstName":"` + name + `","lastName":"Test"},"bio":"Bio","speciesTreated":["dog"],"specialtyId":"` + testSpecialtyID(t, ctx, pool) + `","affiliations":[{"name":"Clinic","isPrimary":true}]}}`
	if _, err := pool.Exec(ctx, `
		INSERT INTO doctor_vet_profiles (user_id, is_published, verification, profile_draft)
		VALUES ($1,$2,$3,$4::jsonb)`, owner, published, verification, draft); err != nil {
		t.Fatalf("profile: %v", err)
	}
	return providerID
}

func testSpecialtyID(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(ctx, `SELECT id::text FROM doctor_specialties ORDER BY slug LIMIT 1`).Scan(&id)
	if err == nil {
		return id
	}
	id = uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO doctor_specialties (id, slug, name) VALUES ($1,$2,'Listing Test Specialty')`, id, "listing-test-"+id); err != nil {
		t.Fatalf("specialty: %v", err)
	}
	return id
}

func TestLiveDB_VetListings_OnlyFullyApprovedAndPublishedVetsAreShown(t *testing.T) {
	ctx := t.Context()
	pool := listAppointmentsLivePool(t)
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	listed := seedVetListing(t, ctx, pool, uuid.NewString(), "Listed", true, "APPROVED", "approved", true)
	hidden := map[string]string{
		"unpublished":          seedVetListing(t, ctx, pool, uuid.NewString(), "Unpublished", true, "APPROVED", "approved", false),
		"verification-pending": seedVetListing(t, ctx, pool, uuid.NewString(), "Pending", true, "APPROVED", "pending", true),
		"not discoverable":     seedVetListing(t, ctx, pool, uuid.NewString(), "Hidden", false, "APPROVED", "approved", true),
		"provider pending":     seedVetListing(t, ctx, pool, uuid.NewString(), "Unapproved", true, "PENDING", "approved", true),
	}

	// Services for the listed vet: TELE has two prices (the lowest wins), HOME one,
	// and an inactive CLINIC is not offered at all.
	for _, row := range []struct {
		visit  string
		price  int64
		active bool
	}{{"TELE", 500000, true}, {"TELE", 300000, true}, {"HOME", 800000, true}, {"CLINIC", 100000, false}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO vet_services (provider_id, code, name, visit_type, price_kobo, active)
			VALUES ($1, $2, 'svc', $3, $4, $5)`, listed, row.visit+"-"+uuid.NewString(), row.visit, row.price, row.active); err != nil {
			t.Fatalf("service: %v", err)
		}
	}

	all, err := svc.ListVetListings(ctx, nil, nil, 0, VetFilter{})
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]VetListing{}
	for _, v := range all {
		seen[v.ID] = v
	}
	got, ok := seen[listed]
	if !ok {
		t.Fatal("the fully approved and published vet must be listed")
	}
	for label, id := range hidden {
		if _, present := seen[id]; present {
			t.Fatalf("a vet that is %s must not be listed", label)
		}
	}

	if got.Name != "Dr. Listed Test" {
		t.Fatalf("name = %q", got.Name)
	}
	if got.ClinicName != "Clinic" || got.Bio != "Bio" {
		t.Fatalf("profile fields: clinic=%q bio=%q", got.ClinicName, got.Bio)
	}
	if got.ConsultFeeKobo != 300000 || got.HomeVisitFeeKobo != 800000 {
		t.Fatalf("fees: consult=%d home=%d, want 300000 / 800000 (lowest active price)", got.ConsultFeeKobo, got.HomeVisitFeeKobo)
	}
	if !contains(got.Types, "tele") || !contains(got.Types, "home") || contains(got.Types, "clinic") {
		t.Fatalf("types = %v: an inactive service must not be offered", got.Types)
	}
	if got.Credential.Authority != "VCN" || got.Credential.Status != "verified" {
		t.Fatalf("credential = %+v", got.Credential)
	}
	if got.Lat == nil || got.Lng == nil {
		t.Fatal("a located provider must carry coordinates")
	}

	one, err := svc.GetVetListing(ctx, listed)
	if err != nil || one.ID != listed {
		t.Fatalf("single listed vet: %v", err)
	}
	// An unlisted vet and a missing vet answer the same way.
	for label, id := range hidden {
		if _, err := svc.GetVetListing(ctx, id); !errors.Is(err, ErrVetNotFound) {
			t.Fatalf("GetVetListing for %s: err = %v, want ErrVetNotFound", label, err)
		}
	}
	if _, err := svc.GetVetListing(ctx, uuid.NewString()); !errors.Is(err, ErrVetNotFound) {
		t.Fatalf("GetVetListing for a missing vet: err = %v, want ErrVetNotFound", err)
	}

	byType, err := svc.ListVetListings(ctx, nil, nil, 0, VetFilter{Type: "home"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, v := range byType {
		if v.ID == listed {
			found = true
		}
	}
	if !found {
		t.Fatal("type=home filter must keep the vet that offers home visits")
	}
}
