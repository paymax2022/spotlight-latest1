package transport

import (
	"context"
	"fmt"
	"math"
)

// loadPricingConfig fetches the active pricing config for a zone+service_type.
// Falls back to the 'default' zone when the requested zone has no active config.
func (s *Service) loadPricingConfig(ctx context.Context, zone, serviceType string) (*PricingConfig, error) {
	if zone == "" {
		zone = "default"
	}
	if serviceType == "" {
		serviceType = "ride_hailing"
	}
	cfg, err := s.queryPricing(ctx, zone, serviceType)
	if err == nil {
		return cfg, nil
	}
	if zone != "default" {
		return s.queryPricing(ctx, "default", serviceType)
	}
	return nil, err
}

func (s *Service) queryPricing(ctx context.Context, zone, serviceType string) (*PricingConfig, error) {
	const q = `
		SELECT id, zone, service_type, currency, base_fare_kobo, per_km_kobo, per_min_kobo,
		       min_fare_kobo, fare_floor_pct, fare_ceiling_pct, driver_profit_floor_kobo,
		       surge_multiplier, cancellation_fee_kobo, waiting_fee_per_min_kobo, active
		FROM transport_pricing_config
		WHERE zone=$1 AND service_type=$2 AND active=TRUE
		LIMIT 1`
	var c PricingConfig
	if err := s.db.QueryRow(ctx, q, zone, serviceType).Scan(
		&c.ID, &c.Zone, &c.ServiceType, &c.Currency, &c.BaseFareKobo, &c.PerKMKobo, &c.PerMinKobo,
		&c.MinFareKobo, &c.FareFloorPct, &c.FareCeilingPct, &c.DriverProfitFloorKobo,
		&c.SurgeMultiplier, &c.CancellationFeeKobo, &c.WaitingFeePerMinKobo, &c.Active,
	); err != nil {
		return nil, fmt.Errorf("transport: pricing config not found for zone=%s service=%s", zone, serviceType)
	}
	return &c, nil
}

// SystemFare computes the recommended fare in kobo from distance + duration.
// fare = (base + per_km*km + per_min*min) * surge, floored at min_fare.
func SystemFare(distanceM, durationS int, cfg *PricingConfig) int64 {
	km := float64(distanceM) / 1000.0
	mins := float64(durationS) / 60.0
	raw := float64(cfg.BaseFareKobo) +
		km*float64(cfg.PerKMKobo) +
		mins*float64(cfg.PerMinKobo)
	surge := cfg.SurgeMultiplier
	if surge <= 0 {
		surge = 1.0
	}
	fare := int64(math.Round(raw * surge))
	if fare < cfg.MinFareKobo {
		fare = cfg.MinFareKobo
	}
	return fare
}

// offerBounds returns the inclusive [min,max] kobo range a rider/driver offer
// must fall within: system_fare * floor_pct .. system_fare * ceiling_pct.
func offerBounds(systemFare int64, cfg *PricingConfig) (int64, int64) {
	min := int64(math.Round(float64(systemFare) * cfg.FareFloorPct))
	max := int64(math.Round(float64(systemFare) * cfg.FareCeilingPct))
	return min, max
}

// EstimateRide geocodes/ routes between two places and produces a fare estimate
// with the offer range a rider may negotiate within.
func (s *Service) EstimateRide(ctx context.Context, req EstimateRequest) (*FareEstimate, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", req.ServiceType)
	if err != nil {
		return nil, err
	}
	route, err := s.maps.Route(ctx,
		LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
		LatLng{Lat: req.Dest.Lat, Lng: req.Dest.Lng},
	)
	if err != nil {
		return nil, err
	}
	system := SystemFare(route.DistanceM, route.DurationS, cfg)
	min, max := offerBounds(system, cfg)
	return &FareEstimate{
		DistanceM:      route.DistanceM,
		DurationS:      route.DurationS,
		SystemFareKobo: system,
		OfferMinKobo:   min,
		OfferMaxKobo:   max,
		Polyline:       route.Polyline,
	}, nil
}
