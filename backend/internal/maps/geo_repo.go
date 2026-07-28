package maps

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GeoRepo is the PostGIS-backed "our own records" access used by findNearbyOwn
// and isInZone. These NEVER call a maps API — proximity and geofencing run on
// our data with GiST indexes (ST_DWithin / ST_Contains). It is an interface so
// the service can be unit-tested with an in-memory fake.
type GeoRepo interface {
	NearbyOwn(ctx context.Context, entityType string, p Point, radiusM float64, limit int) ([]OwnEntity, error)
	InZone(ctx context.Context, p Point, zoneID string) (bool, error)
	UpsertLocation(ctx context.Context, e OwnEntity, entityType, plusCode string) error
}

// PostGISRepo implements GeoRepo against merchant_locations + service_areas.
type PostGISRepo struct {
	pool *pgxpool.Pool
}

// NewPostGISRepo builds a PostGIS GeoRepo.
func NewPostGISRepo(pool *pgxpool.Pool) *PostGISRepo { return &PostGISRepo{pool: pool} }

// NearbyOwn returns OUR records of entityType within radiusM of p, nearest first.
// Uses geography ST_DWithin (true metres) against the GiST index — not a maps API.
func (r *PostGISRepo) NearbyOwn(ctx context.Context, entityType string, p Point, radiusM float64, limit int) ([]OwnEntity, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT entity_id, entity_type,
		       ST_Y(geog::geometry) AS lat,
		       ST_X(geog::geometry) AS lng,
		       COALESCE(plus_code, ''),
		       ST_Distance(geog, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS dist_m
		FROM merchant_locations
		WHERE entity_type = $3
		  AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $4)
		ORDER BY dist_m ASC
		LIMIT $5`
	rows, err := r.pool.Query(ctx, q, p.Lat, p.Lng, entityType, radiusM, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OwnEntity{}
	for rows.Next() {
		var e OwnEntity
		if err := rows.Scan(&e.EntityID, &e.EntityType, &e.Lat, &e.Lng, &e.PlusCode, &e.DistanceM); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// InZone reports whether p falls inside the service_areas polygon zoneID.
// Uses ST_Contains on the GiST-indexed geography — not a maps API.
func (r *PostGISRepo) InZone(ctx context.Context, p Point, zoneID string) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM service_areas
			WHERE id = $1
			  AND ST_Contains(geog::geometry, ST_SetSRID(ST_MakePoint($3, $2), 4326))
		)`
	var inside bool
	if err := r.pool.QueryRow(ctx, q, zoneID, p.Lat, p.Lng).Scan(&inside); err != nil {
		return false, err
	}
	return inside, nil
}

// UpsertLocation writes/updates one of our records' pin (source of truth) and
// its Plus Code. Callers pass the confirmed map pin captured at address entry.
func (r *PostGISRepo) UpsertLocation(ctx context.Context, e OwnEntity, entityType, plusCode string) error {
	const q = `
		INSERT INTO merchant_locations (entity_id, entity_type, geog, plus_code, updated_at)
		VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, NOW())
		ON CONFLICT (entity_id, entity_type)
		DO UPDATE SET geog = EXCLUDED.geog, plus_code = EXCLUDED.plus_code, updated_at = NOW()`
	_, err := r.pool.Exec(ctx, q, e.EntityID, entityType, e.Lat, e.Lng, plusCode)
	return err
}
