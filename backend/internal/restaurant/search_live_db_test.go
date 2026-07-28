package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for restaurant discovery search (Phase 6): text,
// cuisine, min-rating, near-me (via the merchant_locations geo sync), and open_now
// (via business hours) against real rows. Skipped unless TEST_DATABASE_URL/
// DATABASE_URL is set. Requires the restaurant, maps_core, business-hours, and
// search migrations.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func searchLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB search test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func TestLiveDB_SearchRestaurants(t *testing.T) {
	pool := searchLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	// Unique name tokens so the text search can't collide with other rows in a shared DB.
	tag := uuid.New().String()[:8]
	type seed struct {
		id, name, cuisine string
		rating            float64
		lat, lng          float64
		hasGeo            bool
	}
	pizza := seed{uuid.New().String(), "Pizza " + tag, "Italian", 4.8, 6.5, 3.4, true}
	burger := seed{uuid.New().String(), "Burger " + tag, "American", 4.2, 7.5, 4.5, true}
	suya := seed{uuid.New().String(), "Suya " + tag, "Nigerian", 3.5, 0, 0, false}
	for _, s := range []seed{pizza, burger, suya} {
		if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, rating, cuisine) VALUES ($1,$2,$3,'1 St',TRUE,$4,$5)`,
			s.id, owner, s.name, s.rating, s.cuisine); err != nil {
			t.Fatalf("seed restaurant: %v", err)
		}
		if s.hasGeo { // UPDATE fires the merchant_locations sync trigger
			if _, err := pool.Exec(ctx, `UPDATE restaurants SET geo_lat=$2, geo_lng=$3, updated_at=NOW() WHERE id=$1`, s.id, s.lat, s.lng); err != nil {
				t.Fatalf("set geo: %v", err)
			}
		}
	}

	// Restrict results to our seeded set via the text token.
	ids := func(rs []Restaurant) map[string]bool {
		m := map[string]bool{}
		for _, r := range rs {
			m[r.ID] = true
		}
		return m
	}

	// Text: "Pizza <tag>" matches only the pizza row.
	if got, err := svc.SearchRestaurants(ctx, SearchParams{Query: "Pizza " + tag}); err != nil {
		t.Fatalf("text search: %v", err)
	} else if m := ids(got); !m[pizza.id] || m[burger.id] || m[suya.id] {
		t.Fatalf("text search should match only pizza, got %d rows", len(got))
	}

	// Cuisine (case-insensitive).
	if got, err := svc.SearchRestaurants(ctx, SearchParams{Query: tag, Cuisine: "italian"}); err != nil {
		t.Fatalf("cuisine: %v", err)
	} else if m := ids(got); !m[pizza.id] || m[burger.id] {
		t.Fatal("cuisine=italian should match only pizza")
	}

	// Min rating 4.5 → only pizza (4.8).
	if got, err := svc.SearchRestaurants(ctx, SearchParams{Query: tag, MinRating: 4.5}); err != nil {
		t.Fatalf("min_rating: %v", err)
	} else if m := ids(got); !m[pizza.id] || m[burger.id] || m[suya.id] {
		t.Fatal("min_rating 4.5 should match only pizza")
	}

	// Near the pizza pin, 5km: pizza in range, burger (≈150km away) out; distance set.
	near := SearchParams{Query: tag, NearLat: &pizza.lat, NearLng: &pizza.lng, RadiusKm: 5, Sort: "distance"}
	if got, err := svc.SearchRestaurants(ctx, near); err != nil {
		t.Fatalf("near: %v", err)
	} else {
		m := ids(got)
		if !m[pizza.id] || m[burger.id] {
			t.Fatal("near-me 5km should include pizza, exclude the far burger")
		}
		for _, r := range got {
			if r.ID == pizza.id && r.DistanceMeters == nil {
				t.Fatal("near-me result must carry a distance")
			}
		}
	}

	// open_now: give burger a schedule for a day that is neither today nor yesterday,
	// so it is definitively closed now; pizza/suya have no schedule ⇒ open.
	today := int(time.Now().In(lagosTZ).Weekday())
	closedDay := (today + 2) % 7
	if _, err := svc.SetBusinessHours(ctx, burger.id, owner, []BusinessHourInput{{DayOfWeek: closedDay, Open: "09:00", Close: "10:00"}}); err != nil {
		t.Fatalf("set burger hours: %v", err)
	}
	if got, err := svc.SearchRestaurants(ctx, SearchParams{Query: tag, OpenNow: true}); err != nil {
		t.Fatalf("open_now: %v", err)
	} else {
		m := ids(got)
		if !m[pizza.id] || !m[suya.id] {
			t.Fatal("open_now should include the no-schedule restaurants")
		}
		if m[burger.id] {
			t.Fatal("open_now must exclude the restaurant scheduled closed right now")
		}
	}
}
