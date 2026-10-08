package restaurant

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Distance/time-based delivery-fee pricing. PURE LOGIC — no DB, no network — so it
// is unit-tested in isolation; the service loads DeliveryFeeConfig from the DB
// (restaurant_delivery_config, admin-adjustable) and feeds the coordinates.
//	Fee = round((base + extra-distance + extra-time) × demand_multiplier)
//	      + night_fee + weather_fee + handling_fee − promo_discount, clamped to
//	      [min_fee, max_fee].
// Money is integer kobo throughout.

// DeliveryFeeConfig mirrors restaurant_delivery_config (every field admin-editable).
type DeliveryFeeConfig struct {
	BaseFeeKobo       int64   `json:"base_fee_kobo"`
	FreeDistanceKm    float64 `json:"free_distance_km"`
	PerKmKobo         int64   `json:"per_km_kobo"`
	FreeMinutes       float64 `json:"free_minutes"`
	PerMinuteKobo     int64   `json:"per_minute_kobo"`
	DemandMultiplier  float64 `json:"demand_multiplier"`
	NightFeeKobo      int64   `json:"night_fee_kobo"`
	NightStartHour    int     `json:"night_start_hour"`
	NightEndHour      int     `json:"night_end_hour"`
	WeatherFeeKobo    int64   `json:"weather_fee_kobo"`
	HandlingFeeKobo   int64   `json:"handling_fee_kobo"`
	PromoDiscountKobo int64   `json:"promo_discount_kobo"`
	AvgSpeedKmph      float64 `json:"avg_speed_kmph"`
	RoadFactor        float64 `json:"road_factor"`
	MinFeeKobo        int64   `json:"min_fee_kobo"`
	MaxFeeKobo        int64   `json:"max_fee_kobo"` // 0 = no cap
}

// DefaultDeliveryFeeConfig matches the seeded global defaults (the §formula).
func DefaultDeliveryFeeConfig() DeliveryFeeConfig {
	return DeliveryFeeConfig{
		BaseFeeKobo: 80000, FreeDistanceKm: 2, PerKmKobo: 15000,
		FreeMinutes: 25, PerMinuteKobo: 5000, DemandMultiplier: 1.0,
		NightFeeKobo: 0, NightStartHour: 22, NightEndHour: 5,
		WeatherFeeKobo: 0, HandlingFeeKobo: 0, PromoDiscountKobo: 0,
		AvgSpeedKmph: 20, RoadFactor: 1.3, MinFeeKobo: 80000, MaxFeeKobo: 0,
	}
}

// DeliveryFeeBreakdown is the transparent line-by-line result (persisted on the
// order + shown to the buyer).
type DeliveryFeeBreakdown struct {
	DistanceKm   float64 `json:"distance_km"` // road distance used (km)
	EtaMinutes   float64 `json:"eta_minutes"` // estimated delivery time (min)
	BaseKobo     int64   `json:"base_kobo"`
	DistanceKobo int64   `json:"distance_kobo"` // extra-distance fee (after free km)
	TimeKobo     int64   `json:"time_kobo"`     // extra-time fee (after free min)
	SurgeKobo    int64   `json:"surge_kobo"`    // extra added by demand multiplier
	NightKobo    int64   `json:"night_kobo"`
	WeatherKobo  int64   `json:"weather_kobo"`
	HandlingKobo int64   `json:"handling_kobo"`
	PromoKobo    int64   `json:"promo_kobo"` // discount applied (subtracted)
	TotalKobo    int64   `json:"total_kobo"`
}

// HaversineKm is the great-circle (straight-line) distance between two lat/lng
// points in kilometres.
func HaversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthKm = 6371.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := rad(lat2 - lat1)
	dLng := rad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// EstimateEtaMinutes estimates delivery time from a road distance + average speed.
func EstimateEtaMinutes(roadKm float64, cfg DeliveryFeeConfig) float64 {
	if cfg.AvgSpeedKmph <= 0 {
		return 0
	}
	return roadKm / cfg.AvgSpeedKmph * 60.0
}

func roundKobo(v float64) int64 {
	if v < 0 {
		return -int64(math.Round(-v))
	}
	return int64(math.Round(v))
}

// ComputeDeliveryFee applies the configurable formula to a STRAIGHT-LINE distance
// (the road factor + ETA are derived inside). Use this when only a haversine
// distance is available (no routing provider). `night`/`weather` toggle the
// respective surcharges. Pure + deterministic.
func ComputeDeliveryFee(straightLineKm float64, night, weather bool, cfg DeliveryFeeConfig) DeliveryFeeBreakdown {
	if straightLineKm < 0 {
		straightLineKm = 0
	}
	roadFactor := cfg.RoadFactor
	if roadFactor < 1 {
		roadFactor = 1
	}
	roadKm := straightLineKm * roadFactor
	eta := EstimateEtaMinutes(roadKm, cfg)
	return feeFromRoute(roadKm, eta, night, weather, cfg)
}

// ComputeDeliveryFeeFromRoute applies the same configurable formula to an ACTUAL
// driving distance (km) + ETA (minutes) from a routing provider (e.g. Google
// Distance Matrix). The road factor and the speed-based ETA estimate are NOT
// applied — the provider already returns real road distance + time. Pure +
// deterministic.
func ComputeDeliveryFeeFromRoute(roadKm, etaMinutes float64, night, weather bool, cfg DeliveryFeeConfig) DeliveryFeeBreakdown {
	if roadKm < 0 {
		roadKm = 0
	}
	if etaMinutes < 0 {
		etaMinutes = 0
	}
	return feeFromRoute(roadKm, etaMinutes, night, weather, cfg)
}

// feeFromRoute is the shared core: given a road distance (km) + ETA (min) it
// applies the distance/time tiers, demand multiplier, surcharges, promo and clamps.
func feeFromRoute(roadKm, eta float64, night, weather bool, cfg DeliveryFeeConfig) DeliveryFeeBreakdown {
	extraKm := roadKm - cfg.FreeDistanceKm
	if extraKm < 0 {
		extraKm = 0
	}
	distanceKobo := roundKobo(float64(cfg.PerKmKobo) * extraKm)

	extraMin := eta - cfg.FreeMinutes
	if extraMin < 0 {
		extraMin = 0
	}
	timeKobo := roundKobo(float64(cfg.PerMinuteKobo) * extraMin)

	core := cfg.BaseFeeKobo + distanceKobo + timeKobo
	mult := cfg.DemandMultiplier
	if mult <= 0 {
		mult = 1
	}
	afterDemand := roundKobo(float64(core) * mult)
	surge := afterDemand - core

	nightKobo := int64(0)
	if night {
		nightKobo = cfg.NightFeeKobo
	}
	weatherKobo := int64(0)
	if weather {
		weatherKobo = cfg.WeatherFeeKobo
	}

	total := max(
		// Clamp: floor at min (and never below 0), cap at max when set.
		afterDemand+nightKobo+weatherKobo+cfg.HandlingFeeKobo-cfg.PromoDiscountKobo, cfg.MinFeeKobo)
	if cfg.MaxFeeKobo > 0 && total > cfg.MaxFeeKobo {
		total = cfg.MaxFeeKobo
	}
	if total < 0 {
		total = 0
	}

	return DeliveryFeeBreakdown{
		DistanceKm:   math.Round(roadKm*100) / 100,
		EtaMinutes:   math.Round(eta*10) / 10,
		BaseKobo:     cfg.BaseFeeKobo,
		DistanceKobo: distanceKobo,
		TimeKobo:     timeKobo,
		SurgeKobo:    surge,
		NightKobo:    nightKobo,
		WeatherKobo:  weatherKobo,
		HandlingKobo: cfg.HandlingFeeKobo,
		PromoKobo:    cfg.PromoDiscountKobo,
		TotalKobo:    total,
	}
}

// IsNightAt reports whether hour (0-23, delivery-locale) falls in the night window
// (handles windows that wrap past midnight, e.g. 22→5).
func IsNightAt(hour int, cfg DeliveryFeeConfig) bool {
	s, e := cfg.NightStartHour, cfg.NightEndHour
	if s == e {
		return false
	}
	if s < e {
		return hour >= s && hour < e
	}
	return hour >= s || hour < e // wraps midnight
}

// DeliveryConfigRepo loads/stores the admin-adjustable delivery-fee config from
// restaurant_delivery_config (BIGINT kobo, NUMERIC distances/speeds). A global
// row (restaurant_id IS NULL) is the default; an optional per-restaurant row
// overrides it. Service-role pgx access (writes bypass RLS via the pool).
type DeliveryConfigRepo struct {
	db *pgxpool.Pool
}

// NewDeliveryConfigRepo builds a repo over the shared pgx pool.
func NewDeliveryConfigRepo(db *pgxpool.Pool) *DeliveryConfigRepo {
	return &DeliveryConfigRepo{db: db}
}

// DeliveryConfigRow is the stored config row, including metadata not part of the
// pure DeliveryFeeConfig (id/active/version/scope). Returned by GetDeliveryConfig
// for the admin console.
type DeliveryConfigRow struct {
	ID           string            `json:"id"`
	RestaurantID *string           `json:"restaurant_id"` // nil = global default
	Scope        string            `json:"scope"`         // "restaurant" | "global" | "default"
	Active       bool              `json:"active"`
	Version      int               `json:"version"`
	Config       DeliveryFeeConfig `json:"config"`
}

// deliveryConfigCols is the full column list mapping 1:1 to DeliveryFeeConfig + metadata.
const deliveryConfigCols = `
	id, restaurant_id, base_fee_kobo, free_distance_km, per_km_kobo,
	free_minutes, per_minute_kobo, demand_multiplier, night_fee_kobo,
	night_start_hour, night_end_hour, weather_fee_kobo, handling_fee_kobo,
	promo_discount_kobo, avg_speed_kmph, road_factor, min_fee_kobo,
	max_fee_kobo, active, version`

// scanConfigRow maps a SELECT row (deliveryConfigCols order) into a row struct.
func scanConfigRow(row pgx.Row) (*DeliveryConfigRow, error) {
	var r DeliveryConfigRow
	if err := row.Scan(
		&r.ID, &r.RestaurantID,
		&r.Config.BaseFeeKobo, &r.Config.FreeDistanceKm, &r.Config.PerKmKobo,
		&r.Config.FreeMinutes, &r.Config.PerMinuteKobo, &r.Config.DemandMultiplier,
		&r.Config.NightFeeKobo, &r.Config.NightStartHour, &r.Config.NightEndHour,
		&r.Config.WeatherFeeKobo, &r.Config.HandlingFeeKobo, &r.Config.PromoDiscountKobo,
		&r.Config.AvgSpeedKmph, &r.Config.RoadFactor, &r.Config.MinFeeKobo,
		&r.Config.MaxFeeKobo, &r.Active, &r.Version,
	); err != nil {
		return nil, err
	}
	if r.RestaurantID != nil {
		r.Scope = "restaurant"
	} else {
		r.Scope = "global"
	}
	return &r, nil
}

// LoadDeliveryConfig returns the effective config for an order: the active
// per-restaurant row if present, else the active global row, else the in-code
// defaults. Never errors on "missing config" — it falls back. Other DB errors
// also fall back to defaults so a config lookup can never block an order.
func (r *DeliveryConfigRepo) LoadDeliveryConfig(ctx context.Context, restaurantID string) DeliveryFeeConfig {
	// Per-restaurant override.
	if restaurantID != "" {
		row := r.db.QueryRow(ctx,
			`SELECT `+deliveryConfigCols+`
			 FROM restaurant_delivery_config
			 WHERE restaurant_id = $1 AND active = true`, restaurantID)
		if cr, err := scanConfigRow(row); err == nil {
			return cr.Config
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return DefaultDeliveryFeeConfig()
		}
	}
	// Global default.
	row := r.db.QueryRow(ctx,
		`SELECT `+deliveryConfigCols+`
		 FROM restaurant_delivery_config
		 WHERE restaurant_id IS NULL AND active = true`)
	if cr, err := scanConfigRow(row); err == nil {
		return cr.Config
	}
	return DefaultDeliveryFeeConfig()
}

// GetDeliveryConfig returns the stored row (incl. id/active/version/scope) for the
// admin GET. When restaurantID is non-nil it returns that restaurant's row if it
// exists, otherwise the global row. When restaurantID is nil it returns the global
// row. If no row exists at all, it returns the in-code defaults with scope
// "default" (id/version zero-valued, active true).
func (r *DeliveryConfigRepo) GetDeliveryConfig(ctx context.Context, restaurantID *string) (*DeliveryConfigRow, error) {
	if restaurantID != nil && *restaurantID != "" {
		row := r.db.QueryRow(ctx,
			`SELECT `+deliveryConfigCols+`
			 FROM restaurant_delivery_config WHERE restaurant_id = $1`, *restaurantID)
		cr, err := scanConfigRow(row)
		if err == nil {
			return cr, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("restaurant: load delivery config: %w", err)
		}
		// Fall through to global when no per-restaurant row exists.
	}
	row := r.db.QueryRow(ctx,
		`SELECT `+deliveryConfigCols+`
		 FROM restaurant_delivery_config WHERE restaurant_id IS NULL`)
	cr, err := scanConfigRow(row)
	if err == nil {
		return cr, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("restaurant: load delivery config: %w", err)
	}
	// Nothing stored — return in-code defaults.
	return &DeliveryConfigRow{Scope: "default", Active: true, Config: DefaultDeliveryFeeConfig()}, nil
}

// UpsertDeliveryConfig inserts or updates a config row, bumping version on update.
// restaurantID == nil targets the global row (conflicts on the (restaurant_id IS
// NULL) partial unique index); non-nil targets the per-restaurant row (conflicts
// on the restaurant_id partial unique index). Returns the resulting row.
func (r *DeliveryConfigRepo) UpsertDeliveryConfig(ctx context.Context, restaurantID *string, cfg DeliveryFeeConfig, active bool) (*DeliveryConfigRow, error) {
	// The two partial unique indexes require two distinct ON CONFLICT targets.
	conflict := "(restaurant_id) WHERE restaurant_id IS NOT NULL"
	if restaurantID == nil || *restaurantID == "" {
		conflict = "((restaurant_id IS NULL)) WHERE restaurant_id IS NULL"
		restaurantID = nil
	}
	q := `
		INSERT INTO restaurant_delivery_config (
			restaurant_id, base_fee_kobo, free_distance_km, per_km_kobo,
			free_minutes, per_minute_kobo, demand_multiplier, night_fee_kobo,
			night_start_hour, night_end_hour, weather_fee_kobo, handling_fee_kobo,
			promo_discount_kobo, avg_speed_kmph, road_factor, min_fee_kobo,
			max_fee_kobo, active
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		ON CONFLICT ` + conflict + ` DO UPDATE SET
			base_fee_kobo       = EXCLUDED.base_fee_kobo,
			free_distance_km    = EXCLUDED.free_distance_km,
			per_km_kobo         = EXCLUDED.per_km_kobo,
			free_minutes        = EXCLUDED.free_minutes,
			per_minute_kobo     = EXCLUDED.per_minute_kobo,
			demand_multiplier   = EXCLUDED.demand_multiplier,
			night_fee_kobo      = EXCLUDED.night_fee_kobo,
			night_start_hour    = EXCLUDED.night_start_hour,
			night_end_hour      = EXCLUDED.night_end_hour,
			weather_fee_kobo    = EXCLUDED.weather_fee_kobo,
			handling_fee_kobo   = EXCLUDED.handling_fee_kobo,
			promo_discount_kobo = EXCLUDED.promo_discount_kobo,
			avg_speed_kmph      = EXCLUDED.avg_speed_kmph,
			road_factor         = EXCLUDED.road_factor,
			min_fee_kobo        = EXCLUDED.min_fee_kobo,
			max_fee_kobo        = EXCLUDED.max_fee_kobo,
			active              = EXCLUDED.active,
			version             = restaurant_delivery_config.version + 1,
			updated_at          = now()
		RETURNING ` + deliveryConfigCols
	row := r.db.QueryRow(ctx, q,
		restaurantID, cfg.BaseFeeKobo, cfg.FreeDistanceKm, cfg.PerKmKobo,
		cfg.FreeMinutes, cfg.PerMinuteKobo, cfg.DemandMultiplier, cfg.NightFeeKobo,
		cfg.NightStartHour, cfg.NightEndHour, cfg.WeatherFeeKobo, cfg.HandlingFeeKobo,
		cfg.PromoDiscountKobo, cfg.AvgSpeedKmph, cfg.RoadFactor, cfg.MinFeeKobo,
		cfg.MaxFeeKobo, active,
	)
	cr, err := scanConfigRow(row)
	if err != nil {
		return nil, fmt.Errorf("restaurant: upsert delivery config: %w", err)
	}
	return cr, nil
}
