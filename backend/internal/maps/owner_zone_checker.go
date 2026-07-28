package maps

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// OwnerZoneChecker answers "does this delivery point fall inside any service area
// owned by this owner?" against the PostGIS service_areas table. It is the concrete
// implementation behind restaurant.DeliveryZoneChecker (the restaurant package
// declares the interface with plain scalar types so it need not import maps).
//
// Like GeoRepo.InZone this runs entirely on OUR own geofence data (ST_Contains over
// the GiST-indexed geography) — it NEVER calls a maps API.
type OwnerZoneChecker struct {
	pool *pgxpool.Pool
}

// NewOwnerZoneChecker builds an OwnerZoneChecker over the given pool.
func NewOwnerZoneChecker(pool *pgxpool.Pool) *OwnerZoneChecker {
	return &OwnerZoneChecker{pool: pool}
}

// InAnyOwnerZone reports whether (lat,lng) is inside any of ownerID's service areas,
// and whether the owner has drawn any zones at all. A single round-trip returns both:
//
//   - hasZones == false  → the owner defined no service areas (caller should NOT gate).
//   - inZone   == true   → the point is inside at least one of the owner's areas.
//
// The same ST_Contains + ST_SetSRID(ST_MakePoint(lng,lat),4326) expression as
// GeoRepo.InZone is used, so behavior matches the existing single-zone check.
func (c *OwnerZoneChecker) InAnyOwnerZone(ctx context.Context, lat, lng float64, ownerID string) (inZone, hasZones bool, err error) {
	const q = `
		SELECT
			count(*) AS total,
			count(*) FILTER (
				WHERE ST_Contains(geog::geometry, ST_SetSRID(ST_MakePoint($3, $2), 4326))
			) AS inside
		FROM service_areas
		WHERE owner_id = $1`
	var total, inside int64
	if err = c.pool.QueryRow(ctx, q, ownerID, lat, lng).Scan(&total, &inside); err != nil {
		return false, false, err
	}
	return inside > 0, total > 0, nil
}
