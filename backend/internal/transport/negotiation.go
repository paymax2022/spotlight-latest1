package transport

import (
	"context"
	"fmt"
	"math"
	"net/http"

	"spotlight/backend/internal/finance/settlement"
)

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
