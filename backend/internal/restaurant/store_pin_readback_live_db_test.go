package restaurant

// LIVE-DB test for the merchant store READ path, which the pin write already exercised
// but nothing read back.
// `restaurants.plus_code` is nullable with no default and is NULL for almost every row
// in the database (360 of 379 locally), because it is only filled when the owner
// confirms a map pin or the geocoder succeeds. Two things therefore had to be true at
// once, and only a real read proves both:
//	 1. the code an owner confirmed comes back WITH the coordinates, so reopening the
//	    manage screen still shows "Pin set · 6PHV..." — before this the field was
//	    write-only and the confirmation vanished on reload, which reads to the owner as
//	    "my address did not save";
//	 2. a NULL code scans as blank rather than failing the scan. Scanning that column
//	    straight into a string errors on every existing outlet, so the read must
//	    COALESCE it.
// Deliberately NOT covered here: GET /restaurant/:id. That is the customer and admin
// store page, it reads the shared discoveryColumns projection, and its shoppers already
// have the coordinates — putting the owner's pin label on the public payload would mean
// editing three Scan lists to give a number to nobody.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_StorePin_ReadBackCarriesThePlusCode(t *testing.T) {
	pool := menuCartPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	// No geocoder: this test is about what the reads return, not about resolving text.
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Pin Kitchen','1 Marina Rd',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	lat, lng := 6.4281, 3.4219
	code := "6PHV+QF Ikoyi, Lagos"
	got, err := svc.UpdateRestaurant(ctx, restID, owner, UpdateRestaurantRequest{GeoLat: &lat, GeoLng: &lng, PlusCode: code})
	if err != nil {
		t.Fatalf("pin update: %v", err)
	}
	if got.PlusCode != code {
		t.Errorf("the update echo must carry the confirmed code, got %q", got.PlusCode)
	}

	// The manage screen reopens through the owner's list, not through the update echo,
	// and SetAvailability echoes through the same core read — so both paths are the
	// same query and both are what the owner actually sees.
	mine, err := svc.ListMyRestaurants(ctx, owner)
	if err != nil {
		t.Fatalf("owner list: %v", err)
	}
	if len(mine) != 1 {
		t.Fatalf("expected 1 outlet, got %d", len(mine))
	}
	if mine[0].GeoLat == nil || mine[0].GeoLng == nil {
		t.Fatalf("coordinates must read back, got lat=%v lng=%v", mine[0].GeoLat, mine[0].GeoLng)
	}
	if mine[0].PlusCode != code {
		t.Errorf("ListMyRestaurants must return the stored Plus Code, got %q", mine[0].PlusCode)
	}
	// An unrelated later save must not drop it again.
	renamed, err := svc.UpdateRestaurant(ctx, restID, owner, UpdateRestaurantRequest{Name: str("Pin Kitchen Two")})
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.PlusCode != code {
		t.Errorf("a later edit must not erase the confirmed code, got %q", renamed.PlusCode)
	}
	if renamed.GeoLat == nil || math.Abs(*renamed.GeoLat-lat) > 1e-6 {
		t.Errorf("a later edit must not move the pin, got %v", renamed.GeoLat)
	}
}

func TestLiveDB_StorePin_NullPlusCodeReadsBlank(t *testing.T) {
	pool := menuCartPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)
	// The state almost every live outlet is in: coordinates from a geocode that returned
	// no code, so plus_code is NULL rather than empty.
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng, plus_code)
		VALUES ($1,$2,'No Code Kitchen','2 Adeola Odeku',TRUE,6.4281,3.4219,NULL)`, uuid.New().String(), owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	mine, err := svc.ListMyRestaurants(ctx, owner)
	if err != nil {
		t.Fatalf("a NULL plus_code must not fail the owner list scan: %v", err)
	}
	if len(mine) != 1 || mine[0].PlusCode != "" {
		t.Fatalf("expected one outlet with a blank code, got %+v", mine)
	}
	if mine[0].GeoLat == nil || math.Abs(*mine[0].GeoLat-6.4281) > 1e-6 {
		t.Fatalf("the coordinates still have to read, got %v", mine[0].GeoLat)
	}

	// Blank must marshal AWAY, not travel as an empty string a client could render as a
	// location it cannot show.
	body, err := json.Marshal(mine[0])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(body), "plus_code") {
		t.Errorf("an outlet with no code must omit plus_code, got %s", body)
	}
}
