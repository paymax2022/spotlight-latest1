package pricing

import (
	"fmt"

	"spotlight/backend/internal/stays/gateway"
)

// The pricing engine turns a normalised supplier offer into a Paymax DISPLAY price.
// It sits ABOVE the adapters and is config-driven (PRD §10):
//
//   - Rail A (bedbank): display = net rate + Paymax MARKUP (rule-based) + taxes.
//   - Rail B (direct):  display = hotel SELL rate + taxes; Paymax COMMISSION is
//     deducted at settlement, NOT added on top.
//
// FX integrity is load-bearing: every rate carries its Currency; conversion happens
// only through a controlled Converter and is recorded on the breakdown — never
// silent. A missing FX rate is an ERROR, not a guess.

// MarkupRule is one config-driven markup/commission rule. The first matching rule
// (by supplier/destination/star/tier) wins; an empty selector matches anything.
type MarkupRule struct {
	SupplierCode string // "" = any
	City         string // "" = any
	StarRating   int    // 0 = any
	LoyaltyTier  string // "" = any
	// MarkupBps is the Rail-A markup in basis points (e.g. 1200 = 12%) applied to
	// the net rate. CommissionBps is the Rail-B commission in bps deducted at
	// settlement (informational on the breakdown; not added to the guest price).
	MarkupBps     int64
	CommissionBps int64
}

// Config is the engine configuration (admin-managed; D-2). Rules are evaluated in
// order; loyalty/promo stacking caps are config-driven.
type Config struct {
	Rules []MarkupRule
	// DefaultMarkupBps / DefaultCommissionBps apply when no rule matches.
	DefaultMarkupBps     int64
	DefaultCommissionBps int64
	// MaxStackedDiscountBps caps how far promos + loyalty may stack below the floor
	// (e.g. loyalty + mobile may stack to a cap; promos don't stack below floor).
	MaxStackedDiscountBps int64
	// DisplayCurrency is the default display currency (NGN).
	DisplayCurrency string
}

// Converter performs a controlled FX conversion. It returns an error when no rate
// is configured for the pair — FX is never silently assumed. Implemented by the
// finance FX service / a config-driven rate table (D-3: source + spread).
type Converter interface {
	// Convert returns amount in `to` currency plus the applied rate (for the
	// breakdown / audit). ok=false (err non-nil) when the pair is unconfigured.
	Convert(amountKobo int64, from, to string) (converted int64, rate float64, err error)
}

// Discount is one applied loyalty/promo discount line for the breakdown.
type Discount struct {
	Code string `json:"code"`
	Bps  int64  `json:"bps"`
	Kobo int64  `json:"kobo"`
}

// Breakdown is the fully-disclosed price breakdown attached to an offer/reservation.
// Every leg is explicit so FX, markup, commission and discounts are auditable.
type Breakdown struct {
	Rail            gateway.SourceRail `json:"rail"`
	NetRateKobo     int64              `json:"net_rate_kobo"`   // supplier net / hotel sell
	MarkupKobo      int64              `json:"markup_kobo"`     // Rail A only (added)
	CommissionKobo  int64              `json:"commission_kobo"` // Rail B (deducted at settle; informational)
	TaxKobo         int64              `json:"tax_kobo"`
	DiscountKobo    int64              `json:"discount_kobo"`
	Discounts       []Discount         `json:"discounts,omitempty"`
	GrossKobo       int64              `json:"gross_kobo"` // what the guest pays
	SourceCurrency  string             `json:"source_currency"`
	DisplayCurrency string             `json:"display_currency"`
	FXRate          float64            `json:"fx_rate,omitempty"` // 0 when no conversion applied
}

// Engine prices offers per the config + FX converter.
type Engine struct {
	cfg Config
	fx  Converter
}

// NewEngine constructs the pricing engine. fx may be nil only if every rate is
// already in the display currency (no conversion needed); otherwise a nil fx with a
// cross-currency rate is a hard error (never a silent assumption).
func NewEngine(cfg Config, fx Converter) *Engine {
	if cfg.DisplayCurrency == "" {
		cfg.DisplayCurrency = "NGN"
	}
	return &Engine{cfg: cfg, fx: fx}
}

// Price computes the display breakdown for an offer. loyaltyTier + promoCodes drive
// the config-stacked discounts. Returns an error if FX is required but unavailable.
func (e *Engine) Price(o gateway.PropertyOffer, loyaltyTier string, promoBps int64) (Breakdown, error) {
	rule := e.match(o, loyaltyTier)
	b := Breakdown{
		Rail:            o.Rail,
		NetRateKobo:     o.NetRateKobo,
		TaxKobo:         o.TaxKobo,
		SourceCurrency:  o.Currency,
		DisplayCurrency: e.cfg.DisplayCurrency,
	}

	switch o.Rail {
	case gateway.RailBedbank:
		// Rail A: markup ADDED to the net rate.
		b.MarkupKobo = bps(o.NetRateKobo, rule.MarkupBps)
	case gateway.RailDirect:
		// Rail B: commission DEDUCTED at settlement — informational here, never
		// added to the guest-facing gross.
		b.CommissionKobo = bps(o.NetRateKobo, rule.CommissionBps)
	}

	// Loyalty/promo stacking, capped by config (never below the floor).
	discountBps := promoBps
	if discountBps > e.cfg.MaxStackedDiscountBps && e.cfg.MaxStackedDiscountBps > 0 {
		discountBps = e.cfg.MaxStackedDiscountBps
	}
	if discountBps > 0 {
		base := o.NetRateKobo + b.MarkupKobo
		b.DiscountKobo = bps(base, discountBps)
		b.Discounts = append(b.Discounts, Discount{Code: "stacked", Bps: discountBps, Kobo: b.DiscountKobo})
	}

	// Guest-facing gross (Rail A includes markup; Rail B does not include commission).
	gross := o.NetRateKobo + b.MarkupKobo + o.TaxKobo - b.DiscountKobo
	if gross < 0 {
		gross = 0
	}

	// Controlled FX — only when the source currency differs from display. NEVER
	// silent: a missing converter/rate is an error.
	if o.Currency != "" && o.Currency != e.cfg.DisplayCurrency {
		if e.fx == nil {
			return Breakdown{}, fmt.Errorf("pricing: FX required (%s→%s) but no converter configured", o.Currency, e.cfg.DisplayCurrency)
		}
		converted, rate, err := e.fx.Convert(gross, o.Currency, e.cfg.DisplayCurrency)
		if err != nil {
			return Breakdown{}, fmt.Errorf("pricing: FX convert %s→%s: %w", o.Currency, e.cfg.DisplayCurrency, err)
		}
		gross = converted
		b.FXRate = rate
	}
	b.GrossKobo = gross
	return b, nil
}

// PricedTotal returns just the display gross (for dedup's best-bookable selection).
// On an FX error it returns a very large sentinel so a non-priceable offer never
// wins the cheapest-rate comparison.
func (e *Engine) PricedTotal(o gateway.PropertyOffer) int64 {
	b, err := e.Price(o, "", 0)
	if err != nil {
		return 1<<62 - 1
	}
	return b.GrossKobo
}

// match returns the first config rule that matches the offer, else the defaults.
func (e *Engine) match(o gateway.PropertyOffer, loyaltyTier string) MarkupRule {
	for _, r := range e.cfg.Rules {
		if r.SupplierCode != "" && r.SupplierCode != o.SupplierCode {
			continue
		}
		if r.City != "" && r.City != o.City {
			continue
		}
		if r.StarRating != 0 && r.StarRating != o.StarRating {
			continue
		}
		if r.LoyaltyTier != "" && r.LoyaltyTier != loyaltyTier {
			continue
		}
		return r
	}
	return MarkupRule{MarkupBps: e.cfg.DefaultMarkupBps, CommissionBps: e.cfg.DefaultCommissionBps}
}

// bps applies a basis-point rate to a kobo amount with integer rounding.
func bps(amountKobo, b int64) int64 {
	if b <= 0 || amountKobo <= 0 {
		return 0
	}
	return (amountKobo*b + 5000) / 10000
}
