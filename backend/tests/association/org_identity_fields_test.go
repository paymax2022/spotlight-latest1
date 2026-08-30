package association_test

// ---------------------------------------------------------------------------
// The founder-supplied identity fields: acronym, location, website, founded
// year and logo.
//
// WHY THIS EXISTS
// ---------------
// assoc_organisations has carried founded_year, location and website since the
// schema was written, and the admin console's organisation editor has always
// read and written them. The publish INSERT never listed them, and OrgDraft had
// no fields to carry them, so every organisation the mobile wizard created had
// them NULL — and the founder had no way to supply them in the first place. The
// only way an organisation ever got a location was an admin typing one in
// afterwards.
//
// These tests pin both halves: the values survive publish, and the two fields
// the wizard marks required are refused server-side rather than trusted to the
// client that happens to be the only publisher today.
//
// Live-DB, same harness as founder_and_scoping_test.go: skipped without
// TEST_DATABASE_URL.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

// TestPublishOrganisation_PersistsIdentityFields proves the five identity fields
// reach the row. Before this, three of them were dropped on the floor.
func TestPublishOrganisation_PersistsIdentityFields(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@identity.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	draft := newTestDraft("Identity Test " + uuid.New().String()[:8])
	res, err := svc.PublishOrganisation(ctx, userID, draft)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	var acronym, location, website, logoURL *string
	var foundedYear *int
	if err := pool.QueryRow(ctx, `
		SELECT acronym, location, website, logo_url, founded_year
		FROM assoc_organisations WHERE id=$1`, res.OrganisationID,
	).Scan(&acronym, &location, &website, &logoURL, &foundedYear); err != nil {
		t.Fatalf("read organisation: %v", err)
	}

	check := func(field string, got *string, want string) {
		t.Helper()
		if got == nil {
			t.Errorf("%s is NULL — the publish INSERT dropped it", field)
			return
		}
		if *got != want {
			t.Errorf("%s = %q, want %q", field, *got, want)
		}
	}
	check("acronym", acronym, "TST")
	check("location", location, "Lagos, Nigeria")
	check("website", website, "https://test.invalid")
	check("logo_url", logoURL, "https://cdn.test.invalid/logo.png")

	if foundedYear == nil {
		t.Fatalf("founded_year is NULL — the publish INSERT dropped it")
	}
	if *foundedYear != 1999 {
		t.Errorf("founded_year = %d, want 1999", *foundedYear)
	}
}

// TestPublishOrganisation_OptionalIdentityFieldsMayBeBlank proves acronym,
// location and website really are optional: blank must store NULL rather than
// an empty string, so a reader can tell "not provided" from "provided as ”".
func TestPublishOrganisation_OptionalIdentityFieldsMayBeBlank(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@blank.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	draft := newTestDraft("Blank Optional " + uuid.New().String()[:8])
	draft.Acronym = "   " // whitespace must normalise to absent, not to "   "
	draft.Location = ""
	draft.Website = ""

	res, err := svc.PublishOrganisation(ctx, userID, draft)
	if err != nil {
		t.Fatalf("publish: %v — acronym, location and website are optional", err)
	}

	var acronym, location, website *string
	if err := pool.QueryRow(ctx, `
		SELECT acronym, location, website FROM assoc_organisations WHERE id=$1`, res.OrganisationID,
	).Scan(&acronym, &location, &website); err != nil {
		t.Fatalf("read organisation: %v", err)
	}
	for _, f := range []struct {
		name string
		got  *string
	}{{"acronym", acronym}, {"location", location}, {"website", website}} {
		if f.got != nil {
			t.Errorf("%s = %q, want NULL — a blank optional field must not store an empty string", f.name, *f.got)
		}
	}
}

// TestPublishOrganisation_RejectsMissingRequiredIdentity pins the required half.
// The mobile wizard is the only publisher today, so without this the whole
// requirement would live in a client the server does not control.
func TestPublishOrganisation_RejectsMissingRequiredIdentity(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@required.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	nextYear := time.Now().Year() + 1
	tooEarly := 1799

	cases := []struct {
		name   string
		mutate func(*association.OrgDraft)
	}{
		{"no logo", func(d *association.OrgDraft) { d.LogoURL = "" }},
		{"blank logo", func(d *association.OrgDraft) { d.LogoURL = "   " }},
		{"no founded year", func(d *association.OrgDraft) { d.FoundedYear = nil }},
		{"founded year before 1800", func(d *association.OrgDraft) { d.FoundedYear = &tooEarly }},
		{"founded year in the future", func(d *association.OrgDraft) { d.FoundedYear = &nextYear }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			orgName := "Rejected " + uuid.New().String()
			draft := newTestDraft(orgName)
			tc.mutate(&draft)

			if _, err := svc.PublishOrganisation(ctx, userID, draft); err == nil {
				t.Fatalf("publish succeeded with %s — it must be refused", tc.name)
			}

			// And nothing may be written: a rejected publish that still leaves a
			// row is worse than one that errors cleanly.
			var count int
			if err := pool.QueryRow(ctx,
				`SELECT count(*) FROM assoc_organisations WHERE name=$1`, orgName).Scan(&count); err != nil {
				t.Fatalf("count orgs: %v", err)
			}
			if count != 0 {
				t.Errorf("organisation row written despite %s (count=%d)", tc.name, count)
			}
		})
	}
}

// TestPublishOrganisation_AcceptsBoundaryFoundedYears proves the bounds are
// inclusive and match the admin console's editor (1800 → this year), so an
// organisation cannot be valid on one surface and rejected on the other.
func TestPublishOrganisation_AcceptsBoundaryFoundedYears(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@bounds.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	for _, year := range []int{1800, time.Now().Year()} {
		y := year
		draft := newTestDraft("Bounds " + uuid.New().String()[:8])
		draft.FoundedYear = &y
		if _, err := svc.PublishOrganisation(ctx, userID, draft); err != nil {
			t.Errorf("founded year %d rejected: %v — the bounds must be inclusive", y, err)
		}
	}
}
