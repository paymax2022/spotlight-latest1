package restaurant

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
