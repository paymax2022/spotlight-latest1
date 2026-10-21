package restaurant

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// FOOD-UAT-C-003 — delivery serviceability.
//
// Distances are integer "km_bps" (kilometres x 10000). The effective limit is the
// LARGEST radius_km zone configured for the restaurant (a store may have several;
// an address inside any of them is served), else restaurants.max_delivery_km_bps,
// else no limit (permissive, so existing stores keep working). Polygon zones are
// schema-reserved but not evaluated yet; a store with only polygon zones falls
// through to the default.

const kmBps = 10000

// ErrNotServiceable — the address is outside the restaurant's delivery zone.
var ErrNotServiceable = errors.New("restaurant: delivery address is outside this restaurant's delivery zone")

// ServiceabilityError carries the configured limit for the 400 body.
type ServiceabilityError struct {
	DistanceKmBps int
	MaxKmBps      int
}

func (e *ServiceabilityError) Error() string { return ErrNotServiceable.Error() }
func (e *ServiceabilityError) Unwrap() error { return ErrNotServiceable }

// DeliveryZone is one admin-configured zone.
type DeliveryZone struct {
	ID           string    `json:"id"`
	RestaurantID string    `json:"restaurant_id"`
	Kind         string    `json:"kind"`
	RadiusKmBps  *int      `json:"radius_km_bps,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	CreatedBy    *string   `json:"created_by,omitempty"`
}

// CheckServiceable reports whether (lat,lng) is deliverable from the restaurant.
// On a miss it returns ok=false, the measured distance, and a *ServiceabilityError
// (errors.Is ErrNotServiceable). No configured limit, or a restaurant without a
// pin, is permissive (ok=true). Unknown restaurant ids are permissive too: the
// downstream handler owns not-found.
func (s *Service) CheckServiceable(ctx context.Context, restaurantID string, lat, lng float64) (bool, int, error) {
	var gLat, gLng *float64
	var def *int
	err := s.db.QueryRow(ctx, `SELECT geo_lat::float8, geo_lng::float8, max_delivery_km_bps FROM restaurants WHERE id=$1`, restaurantID).Scan(&gLat, &gLng, &def)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, 0, nil
	}
	if err != nil {
		return false, 0, fmt.Errorf("restaurant: load serviceability: %w", err)
	}
	var zoneMax *int
	if err := s.db.QueryRow(ctx, `SELECT MAX(radius_km_bps) FROM restaurant_delivery_zones WHERE restaurant_id=$1 AND kind='radius_km'`, restaurantID).Scan(&zoneMax); err != nil {
		return false, 0, fmt.Errorf("restaurant: load zones: %w", err)
	}
	limit := zoneMax
	if limit == nil {
		limit = def
	}
	if limit == nil || gLat == nil || gLng == nil {
		return true, 0, nil
	}
	dist := int(HaversineKm(*gLat, *gLng, lat, lng)*kmBps + 0.5)
	if dist > *limit {
		return false, dist, &ServiceabilityError{DistanceKmBps: dist, MaxKmBps: *limit}
	}
	return true, dist, nil
}

// ListZones returns a restaurant's zones, oldest first.
func (s *Service) ListZones(ctx context.Context, restaurantID string) ([]DeliveryZone, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, restaurant_id::text, kind, radius_km_bps, created_at, created_by
	  FROM restaurant_delivery_zones WHERE restaurant_id=$1 ORDER BY created_at, id`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeliveryZone{}
	for rows.Next() {
		var z DeliveryZone
		if err := rows.Scan(&z.ID, &z.RestaurantID, &z.Kind, &z.RadiusKmBps, &z.CreatedAt, &z.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, z)
	}
	return out, rows.Err()
}

// CreateRadiusZone adds a radius zone (radiusKmBps > 0).
func (s *Service) CreateRadiusZone(ctx context.Context, restaurantID, adminID string, radiusKmBps int) (*DeliveryZone, error) {
	if radiusKmBps <= 0 || radiusKmBps > 500*kmBps {
		return nil, errors.New("restaurant: radius_km_bps must be between 1 and 5000000 (500 km)")
	}
	var z DeliveryZone
	err := s.db.QueryRow(ctx, `INSERT INTO restaurant_delivery_zones (restaurant_id, kind, radius_km_bps, created_by)
	  SELECT r.id, 'radius_km', $2, NULLIF($3,'') FROM restaurants r WHERE r.id=$1
	  RETURNING id::text, restaurant_id::text, kind, radius_km_bps, created_at, created_by`, restaurantID, radiusKmBps, adminID).
		Scan(&z.ID, &z.RestaurantID, &z.Kind, &z.RadiusKmBps, &z.CreatedAt, &z.CreatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, pgx.ErrNoRows // restaurant not found
	}
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		s.audit.LogAction(adminID, "", "restaurant.zone.created", "restaurant", "restaurant", restaurantID,
			nil, map[string]any{"zone_id": z.ID, "radius_km_bps": radiusKmBps}, "", "", "info")
	}
	return &z, nil
}

// DeleteZone removes a zone; reports whether one was removed.
func (s *Service) DeleteZone(ctx context.Context, restaurantID, zoneID, adminID string) (bool, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM restaurant_delivery_zones WHERE id=$1 AND restaurant_id=$2`, zoneID, restaurantID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() > 0 && s.audit != nil {
		s.audit.LogAction(adminID, "", "restaurant.zone.deleted", "restaurant", "restaurant", restaurantID, map[string]any{"zone_id": zoneID}, nil, "", "", "info")
	}
	return tag.RowsAffected() > 0, nil
}
