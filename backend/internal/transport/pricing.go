package transport

import (
	"context"
	"fmt"
	"maps"
	"math"
	"net/http"

	"spotlight/backend/internal/finance/settlement"
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
		       surge_multiplier, cancellation_fee_kobo, waiting_fee_per_min_kobo,
		       insurance_rate_bps, active
		FROM transport_pricing_config
		WHERE zone=$1 AND service_type=$2 AND active=TRUE
		LIMIT 1`
	var c PricingConfig
	if err := s.db.QueryRow(ctx, q, zone, serviceType).Scan(
		&c.ID, &c.Zone, &c.ServiceType, &c.Currency, &c.BaseFareKobo, &c.PerKMKobo, &c.PerMinKobo,
		&c.MinFareKobo, &c.FareFloorPct, &c.FareCeilingPct, &c.DriverProfitFloorKobo,
		&c.SurgeMultiplier, &c.CancellationFeeKobo, &c.WaitingFeePerMinKobo,
		&c.InsuranceRateBps, &c.Active,
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

// settlementSplitAllProvider routes 100% of a settlement to the provider (used
// for tips, which carry no platform commission).
func settlementSplitAllProvider(providerUserID string) settlement.Split {
	return settlement.Split{ProviderID: providerUserID, ProviderPct: 1.0, PlatformPct: 0.0}
}

// commissionForTier loads the active commission split for a tier, defaulting to
// the standard 80/20 split when the tier row is missing.
func (s *Service) commissionForTier(ctx context.Context, tier string) (*CommissionConfig, error) {
	if tier == "" {
		tier = "standard"
	}
	const q = `SELECT tier, provider_pct, platform_pct, active FROM transport_commission_config WHERE tier=$1 AND active=TRUE`
	var c CommissionConfig
	if err := s.db.QueryRow(ctx, q, tier).Scan(&c.Tier, &c.ProviderPct, &c.PlatformPct, &c.Active); err != nil {
		// Fail-safe default split.
		return &CommissionConfig{Tier: "standard", ProviderPct: 0.80, PlatformPct: 0.20, Active: true}, nil
	}
	return &c, nil
}

// validateFareInRange enforces the admin fare floor/ceiling pct bounds.
// Returns a 422 CodedError when the offer is outside the range.
func validateFareInRange(offer, systemFare int64, cfg *PricingConfig) error {
	min, max := offerBounds(systemFare, cfg)
	if offer < min {
		return codedErr(http.StatusUnprocessableEntity, CodeFareBelowFloor,
			fmt.Sprintf("offer %d kobo is below the minimum %d kobo (%.0f%% of system fare)", offer, min, cfg.FareFloorPct*100))
	}
	if offer > max {
		return codedErr(http.StatusUnprocessableEntity, CodeFareAboveCeiling,
			fmt.Sprintf("offer %d kobo is above the maximum %d kobo (%.0f%% of system fare)", offer, max, cfg.FareCeilingPct*100))
	}
	return nil
}

// enforceDriverProfitFloor rejects any accepted fare that, after commission,
// leaves the driver below driver_profit_floor_kobo. Returns a 422 CodedError.
func enforceDriverProfitFloor(acceptedFare int64, comm *CommissionConfig, cfg *PricingConfig) error {
	driverNet := int64(math.Floor(float64(acceptedFare) * comm.ProviderPct))
	if driverNet < cfg.DriverProfitFloorKobo {
		return codedErr(http.StatusUnprocessableEntity, CodeProfitFloor,
			fmt.Sprintf("accepted fare leaves driver %d kobo (net of %.0f%% commission), below profit floor %d kobo",
				driverNet, comm.PlatformPct*100, cfg.DriverProfitFloorKobo))
	}
	return nil
}

// validateAcceptedFare combines range + driver-profit-floor checks. This is the
// single gate every fare-accepting transition must pass.
func (s *Service) validateAcceptedFare(ctx context.Context, fare, systemFare int64, driverTier string, cfg *PricingConfig) error {
	if err := validateFareInRange(fare, systemFare, cfg); err != nil {
		return err
	}
	comm, err := s.commissionForTier(ctx, driverTier)
	if err != nil {
		return err
	}
	return enforceDriverProfitFloor(fare, comm, cfg)
}

// settlementSplit builds a provider/platform split from a commission config.
// serviceFeeKobo is a fixed amount carved out 100% to the platform BEFORE the
// percentage split applies (e.g. a parcel's insurance premium — the provider
// never earns commission on cover they don't underwrite). Zero for modes with
// no such fee, reproducing the pure percentage split unchanged.
func settlementSplit(providerUserID string, comm *CommissionConfig, serviceFeeKobo int64) settlement.Split {
	return settlement.Split{
		ProviderID:     providerUserID,
		ProviderPct:    comm.ProviderPct,
		PlatformPct:    comm.PlatformPct,
		ServiceFeeKobo: serviceFeeKobo,
	}
}

// These modes don't use the trips/trip_events tables. State changes are recorded
// as immutable rows in transport_audit_log via recordModeEvent, which reuses the
// same audit sink as admin mutations (actor, action, entity, old/new, reason).

// recordModeEvent logs a mode state transition / lifecycle event to the audit log.
// actorID is the user (sender/courier/operator/provider) who triggered it.
func (s *Service) recordModeEvent(ctx context.Context, actorID, action, entityType, entityID string, from, to string, meta map[string]any) {
	oldVal := map[string]any{"status": from}
	newVal := map[string]any{"status": to}
	maps.Copy(newVal, meta)
	// writeAudit stores actor as admin_id; for mode events the actor is the
	// customer/provider. Reason is left empty.
	_ = writeAudit(ctx, s.db, actorID, action, entityType, entityID, oldVal, newVal, "")
}

// settleModeProvider settles a single escrow settlement to a provider/driver with
// the provider's commission tier split. settlementID is the row escrowed at booking.
// serviceFeeKobo (usually 0) is carved out 100% to the platform before the
// percentage split — see settlementSplit.
func (s *Service) settleModeProvider(ctx context.Context, settlementID, providerDriverID string, serviceFeeKobo int64) error {
	var providerUserID, tier string
	if providerDriverID != "" {
		s.db.QueryRow(ctx, `SELECT user_id, commission_tier FROM drivers WHERE id=$1`, providerDriverID).Scan(&providerUserID, &tier)
	}
	comm, err := s.commissionForTier(ctx, tier)
	if err != nil {
		return err
	}
	split := settlementSplit(providerUserID, comm, serviceFeeKobo)
	return s.settlement.Settle(ctx, settlementID, split)
}
