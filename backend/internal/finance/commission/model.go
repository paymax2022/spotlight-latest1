package commission

import "time"

// FeeModel enumerates the CHECK-constrained fee_model values in commission_config.
type FeeModel string

const (
	FeeModelCommission        FeeModel = "commission"
	FeeModelPlatformCharge    FeeModel = "platform_charge"
	FeeModelFixed             FeeModel = "fixed"
	FeeModelCommissionPlusFee FeeModel = "commission_plus_fee"
	FeeModelNone              FeeModel = "none"
)

// fee_payer values (CHECK-constrained). Only 'customer' shifts the platform charge
// onto the customer total; the others are borne by provider/merchant and never
// increase what the customer pays.
const (
	FeePayerCustomer = "customer"
	FeePayerProvider = "provider"
	FeePayerMerchant = "merchant"
	FeePayerNone     = "none"
)

// Config is one row of the commission rate registry (public.commission_config).
// All money is integer minor units (kobo); all rates are basis points (bps).
type Config struct {
	ID                 string    `json:"id"`
	ServiceCategory    string    `json:"serviceCategory"`
	Service            string    `json:"service"`
	ServiceSubtype     string    `json:"serviceSubtype"`
	FeeModel           string    `json:"feeModel"`
	CommissionBps      int64     `json:"commissionBps"`
	PlatformChargeBps  int64     `json:"platformChargeBps"`
	ConvenienceFeeKobo int64     `json:"convenienceFeeKobo"`
	FixedFeeKobo       int64     `json:"fixedFeeKobo"`
	FeePayer           string    `json:"feePayer"`
	Currency           string    `json:"currency"`
	Active             bool      `json:"active"`
	Notes              string    `json:"notes,omitempty"`
	UpdatedBy          *string   `json:"updatedBy,omitempty"`
	UpdatedAt          time.Time `json:"updatedAt"`
	CreatedAt          time.Time `json:"createdAt"`
}

// ConfigInput is the admin-supplied payload to create or update a config row.
// Active is a pointer so "field omitted" (nil) can default to active on create.
type ConfigInput struct {
	ServiceCategory    string `json:"serviceCategory" binding:"required"`
	Service            string `json:"service" binding:"required"`
	ServiceSubtype     string `json:"serviceSubtype"`
	FeeModel           string `json:"feeModel"`
	CommissionBps      int64  `json:"commissionBps"`
	PlatformChargeBps  int64  `json:"platformChargeBps"`
	ConvenienceFeeKobo int64  `json:"convenienceFeeKobo"`
	FixedFeeKobo       int64  `json:"fixedFeeKobo"`
	FeePayer           string `json:"feePayer"`
	Currency           string `json:"currency"`
	Active             *bool  `json:"active"`
	Notes              string `json:"notes"`
}

// CalcRequest is the body of POST /commission/calculate.
type CalcRequest struct {
	ServiceCategory string `json:"serviceCategory" binding:"required"`
	Service         string `json:"service" binding:"required"`
	ServiceSubtype  string `json:"serviceSubtype"`
	AmountKobo      int64  `json:"amountKobo"`
}

// CalcResult is the full fee breakdown for a gross amount, resolved against a
// config (with subtype→service-level fallback). Every field is integer kobo.
type CalcResult struct {
	ConfigID             string `json:"configId"`
	ServiceCategory      string `json:"serviceCategory"`
	Service              string `json:"service"`
	ServiceSubtype       string `json:"serviceSubtype"`
	FeeModel             string `json:"feeModel"`
	FeePayer             string `json:"feePayer"`
	Currency             string `json:"currency"`
	GrossAmountKobo      int64  `json:"grossAmountKobo"`
	CommissionKobo       int64  `json:"commissionKobo"`
	PlatformChargeKobo   int64  `json:"platformChargeKobo"`
	ConvenienceFeeKobo   int64  `json:"convenienceFeeKobo"`
	FixedFeeKobo         int64  `json:"fixedFeeKobo"`
	SpotlightRevenueKobo int64  `json:"spotlightRevenueKobo"`
	CustomerTotalKobo    int64  `json:"customerTotalKobo"`
}

// EarningInput is what a source module hands to RecordEarning. The fee breakdown
// is derived server-side from the resolved config (never trusted from the caller)
// so realized earnings can never drift from the active rate card.
type EarningInput struct {
	ServiceCategory string  `json:"serviceCategory" binding:"required"`
	Service         string  `json:"service" binding:"required"`
	ServiceSubtype  string  `json:"serviceSubtype"`
	GrossAmountKobo int64   `json:"grossAmountKobo"`
	SourceModule    string  `json:"sourceModule" binding:"required"`
	SourceRef       string  `json:"sourceRef" binding:"required"`
	UserID          *string `json:"userId"`
	Currency        string  `json:"currency"`
}

// Earning is one immutable row of realized Spotlight profit (public.commission_earnings).
type Earning struct {
	ID                   string    `json:"id"`
	ConfigID             *string   `json:"configId,omitempty"`
	ServiceCategory      string    `json:"serviceCategory"`
	Service              string    `json:"service"`
	ServiceSubtype       string    `json:"serviceSubtype"`
	GrossAmountKobo      int64     `json:"grossAmountKobo"`
	CommissionKobo       int64     `json:"commissionKobo"`
	PlatformChargeKobo   int64     `json:"platformChargeKobo"`
	ConvenienceFeeKobo   int64     `json:"convenienceFeeKobo"`
	FixedFeeKobo         int64     `json:"fixedFeeKobo"`
	SpotlightRevenueKobo int64     `json:"spotlightRevenueKobo"`
	Currency             string    `json:"currency"`
	SourceModule         string    `json:"sourceModule"`
	SourceRef            string    `json:"sourceRef"`
	LedgerRef            *string   `json:"ledgerRef,omitempty"`
	UserID               *string   `json:"userId,omitempty"`
	IdempotencyKey       *string   `json:"idempotencyKey,omitempty"`
	CreatedAt            time.Time `json:"createdAt"`
}

// ReportRow is one aggregated bucket in a ProfitReport. GroupKey is the value of
// the grouping dimension (category name, "category / service", or ISO day).
type ReportRow struct {
	GroupBy              string `json:"groupBy"`
	GroupKey             string `json:"groupKey"`
	ServiceCategory      string `json:"serviceCategory,omitempty"`
	Service              string `json:"service,omitempty"`
	Day                  string `json:"day,omitempty"`
	Count                int64  `json:"count"`
	GrossAmountKobo      int64  `json:"grossAmountKobo"`
	CommissionKobo       int64  `json:"commissionKobo"`
	PlatformChargeKobo   int64  `json:"platformChargeKobo"`
	ConvenienceFeeKobo   int64  `json:"convenienceFeeKobo"`
	FixedFeeKobo         int64  `json:"fixedFeeKobo"`
	SpotlightRevenueKobo int64  `json:"spotlightRevenueKobo"`
}
