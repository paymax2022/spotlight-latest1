//go:build integration

// Integration tests for the MapService PostGIS paths. Excluded from the normal
// build/test (no DB); run with: go test -tags=integration ./internal/maps/...
// against a migrated Postgres+PostGIS (CI boots Supabase; see maps-ci.yml).
//
// Set TEST_DATABASE_URL (or DATABASE_URL) to a DB where the 20260626* maps
// migrations have been applied. The test cleans up everything it creates.
package maps

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func itestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL — skipping PostGIS integration test")
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

func TestIntegration_NearbyAndZone(t *testing.T) {
	ctx := context.Background()
	pool := itestPool(t)
	defer pool.Close()

	const etype = "itest_merchant"
	_, _ = pool.Exec(ctx, `DELETE FROM merchant_locations WHERE entity_type=$1`, etype)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM merchant_locations WHERE entity_type=$1`, etype) })

	ins := func(id string, lat, lng float64) {
		_, err := pool.Exec(ctx,
			`INSERT INTO merchant_locations (entity_id, entity_type, geog)
			 VALUES ($1,$2, ST_SetSRID(ST_MakePoint($4,$3),4326)::geography)`,
			id, etype, lat, lng)
		if err != nil {
			t.Fatalf("insert loc: %v", err)
		}
	}
	ins("near", 6.4541, 3.3947) // exactly on the query point → distance 0
	ins("far", 6.4600, 3.4000)  // ~700m away

	repo := NewPostGISRepo(pool)
	q := Point{Lat: 6.4541, Lng: 3.3947}

	got, err := repo.NearbyOwn(ctx, etype, q, 5000, 10)
	if err != nil {
		t.Fatalf("NearbyOwn: %v", err)
	}
	if len(got) < 2 {
		t.Fatalf("expected >=2 nearby, got %d", len(got))
	}
	if got[0].EntityID != "near" {
		t.Fatalf("nearest should be 'near', got %q", got[0].EntityID)
	}
	if got[0].DistanceM > got[1].DistanceM {
		t.Fatalf("results not sorted by distance: %v", got)
	}

	// Tight radius excludes the far row (ST_DWithin in true metres).
	tight, err := repo.NearbyOwn(ctx, etype, q, 50, 10)
	if err != nil {
		t.Fatalf("NearbyOwn tight: %v", err)
	}
	if len(tight) != 1 || tight[0].EntityID != "near" {
		t.Fatalf("50m radius should return only 'near', got %+v", tight)
	}

	// Geofence via ST_Contains.
	const zone = "itest_zone"
	_, _ = pool.Exec(ctx, `DELETE FROM service_areas WHERE id=$1`, zone)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM service_areas WHERE id=$1`, zone) })
	_, err = pool.Exec(ctx,
		`INSERT INTO service_areas (id, name, geog)
		 VALUES ($1,'itest', ST_SetSRID(ST_GeomFromText($2),4326)::geography)`,
		zone, "POLYGON((3.30 6.40,3.50 6.40,3.50 6.55,3.30 6.55,3.30 6.40))")
	if err != nil {
		t.Fatalf("insert zone: %v", err)
	}
	if in, _ := repo.InZone(ctx, Point{Lat: 6.45, Lng: 3.39}, zone); !in {
		t.Fatal("expected point inside zone")
	}
	if in, _ := repo.InZone(ctx, Point{Lat: 6.10, Lng: 3.10}, zone); in {
		t.Fatal("expected point outside zone")
	}
}

func TestIntegration_GeocodeCache(t *testing.T) {
	ctx := context.Background()
	pool := itestPool(t)
	defer pool.Close()

	cache := NewCache(pool, time.Hour)
	key := NormalizeQuery("itest 10 Awolowo Road, Ikoyi")
	_, _ = pool.Exec(ctx, `DELETE FROM geocode_cache WHERE normalized_query IN ($1,$2)`, key, "itest_g")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM geocode_cache WHERE normalized_query IN ($1,$2)`, key, "itest_g")
	})

	// OSM result is cached and read back.
	if err := cache.Put(ctx, key, GeoResult{
		Lat: 6.45, Lng: 3.39, PlusCode: "6FR5C2X8+9V",
		Provider: "geoapify", Source: SourceOpenStack, Cacheable: true,
	}); err != nil {
		t.Fatalf("cache put: %v", err)
	}
	hit, ok := cache.Get(ctx, key)
	if !ok || hit.Lat != 6.45 || hit.Provider != "geoapify" {
		t.Fatalf("expected cache hit, got ok=%v %+v", ok, hit)
	}

	// Google result is REFUSED (no-cache guard) and never written.
	err := cache.Put(ctx, "itest_g", GeoResult{Provider: "google", Source: SourceGoogle, Cacheable: false})
	if !errors.Is(err, ErrNotCacheable) {
		t.Fatalf("expected ErrNotCacheable for google, got %v", err)
	}
	if _, ok := cache.Get(ctx, "itest_g"); ok {
		t.Fatal("google result must not be in the cache")
	}
}

func TestIntegration_UsageCap(t *testing.T) {
	ctx := context.Background()
	pool := itestPool(t)
	defer pool.Close()

	const prov = "itest_prov"
	month := currentMonth()
	_, _ = pool.Exec(ctx, `DELETE FROM map_usage WHERE provider=$1`, prov)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM map_usage WHERE provider=$1`, prov) })

	ut := NewUsageTracker(pool, map[string]int64{capKey(prov, PrimGeocode): 2}, func(string, Primitive, int, int64, int64) {})
	ut.Record(ctx, prov, PrimGeocode)
	if c := ut.Record(ctx, prov, PrimGeocode); c != 2 {
		t.Fatalf("expected count 2 after two records, got %d", c)
	}
	if !ut.OverSoftCap(ctx, prov, PrimGeocode) {
		t.Fatal("expected OverSoftCap=true at the cap")
	}
	rows, err := ut.Snapshot(ctx)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	found := false
	for _, r := range rows {
		if r.Provider == prov && r.Primitive == string(PrimGeocode) && r.Month == month && r.Count == 2 {
			found = true
		}
	}
	if !found {
		t.Fatal("usage snapshot missing the recorded row")
	}
}

// TestIntegration_TriggerSync validates the 20260626000200 migration: a
// restaurant gaining coordinates projects into merchant_locations, and deleting
// it removes the row. Skips if auth.users cannot be seeded (non-Supabase DB).
func TestIntegration_TriggerSync(t *testing.T) {
	ctx := context.Background()
	pool := itestPool(t)
	defer pool.Close()

	uid := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, uid, uid+"@itest.local"); err != nil {
		t.Skipf("cannot seed auth.users (%v) — skipping trigger sync test", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, uid) })

	rid := uuid.New().String()
	_, _ = pool.Exec(ctx, `DELETE FROM merchant_locations WHERE entity_id=$1`, rid)
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address) VALUES ($1,$2,$3,$4)`,
		rid, uid, "itest resto", "Ikoyi"); err != nil {
		t.Fatalf("insert restaurant: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM restaurants WHERE id=$1`, rid) })

	count := func() int {
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM merchant_locations WHERE entity_id=$1 AND entity_type='restaurant'`, rid).Scan(&n)
		return n
	}

	if count() != 0 {
		t.Fatal("no coordinates yet → expected 0 merchant_locations rows")
	}
	// Gaining a pin fires the sync trigger.
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET geo_lat=$2, geo_lng=$3 WHERE id=$1`, rid, 6.4541, 3.3947); err != nil {
		t.Fatalf("update geo: %v", err)
	}
	if count() != 1 {
		t.Fatal("expected 1 merchant_locations row after setting coordinates")
	}
	// Near-me finds it through the Go path.
	repo := NewPostGISRepo(pool)
	got, _ := repo.NearbyOwn(ctx, "restaurant", Point{Lat: 6.4541, Lng: 3.3947}, 100, 10)
	hit := false
	for _, e := range got {
		if e.EntityID == rid {
			hit = true
		}
	}
	if !hit {
		t.Fatal("synced restaurant not returned by FindNearbyOwn")
	}
	// Deleting the source row removes the projection.
	if _, err := pool.Exec(ctx, `DELETE FROM restaurants WHERE id=$1`, rid); err != nil {
		t.Fatalf("delete restaurant: %v", err)
	}
	if count() != 0 {
		t.Fatal("expected merchant_locations row removed after delete")
	}
}
