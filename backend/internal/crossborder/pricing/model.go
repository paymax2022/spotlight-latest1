// Package pricing is the SP-3a pricing model: fee schedule, most-specific-wins
// resolver, one rounding policy, and fail-closed guardrails. It is pure logic —
// no ledger posting, no HTTP, no provider calls. All money is int64 minor units.
//
// Import note: Money and currency minor-unit metadata are reused from
// orchestration. orchestration must therefore never import this package
// (callers wire the two together from a higher layer) or an import cycle forms.
package pricing

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"spotlight/backend/internal/orchestration"
)

// Money is the canonical money object (int64 minor units + ISO-4217 code).
type Money = orchestration.Money

// NewMoney builds a Money, normalising the currency to upper-case.
func NewMoney(minor int64, currency string) Money { return orchestration.NewMoney(minor, currency) }

// Level is the precedence tier of a rule; a higher value always beats a lower one.
type Level int

const (
	LevelUniversal       Level = iota + 1 // universal default
	LevelCurrencyPair                     // currency-pair
	LevelCorridorService                  // corridor x service
	LevelPlanBand                         // plan x corridor x service x band
	LevelNegotiated                       // negotiated (per-customer)
	LevelPromo                            // promo
	LevelOverride                         // per-transfer override
)

// PayerMode says who bears the platform fee.
type PayerMode string

const (
	PayerFeeOnTop    PayerMode = "FEE_ON_TOP"   // sender pays amount + fee (default send)
	PayerFeeIncluded PayerMode = "FEE_INCLUDED" // fee deducted from what the receiver gets
	PayerSplit       PayerMode = "SPLIT"        // marketplace: sender ceil(fee/2), receiver the rest
)

// Payer identifies who a quote line is charged to.
type Payer string

const (
	PayerSender   Payer = "SENDER"
	PayerReceiver Payer = "RECEIVER"
	PayerPlatform Payer = "PLATFORM"
)

// RuleStatus is the maker-checker lifecycle state of a rule.
type RuleStatus string

const (
	StatusDraft   RuleStatus = "draft"
	StatusActive  RuleStatus = "active"
	StatusRetired RuleStatus = "retired"
)

// FeeSpec is the L1 fee formula: clamp(flat + ceil(pct_bps*amount), min, max).
// MaxMinor == 0 means no upper clamp.
type FeeSpec struct {
	FlatMinor int64 `json:"flat"`
	PctBPS    int64 `json:"pct_bps"`
	MinMinor  int64 `json:"min"`
	MaxMinor  int64 `json:"max"`
}

// FeeRule is one row of the fee schedule. Empty string fields are wildcards.
// AmountMax == 0 means the band is unbounded above.
type FeeRule struct {
	ID        string
	Level     Level
	SubjectID string // transfer / customer / promo code for Override/Promo/Negotiated levels
	Service   string
	Direction string
	Corridor  string
	Rail      string
	Currency  string
	Plan      string
	Tier      string
	AmountMin int64
	AmountMax int64
	Fee       FeeSpec
	PayerMode PayerMode
	ValidFrom time.Time // zero = open
	ValidTo   time.Time // zero = open (exclusive)
	Status    RuleStatus
	Maker     string
	Checker   string
}

// FeeSchedule is the set of rules the resolver selects from.
type FeeSchedule struct {
	Rules []FeeRule
}

// Validate rejects structurally unsafe schedules (fail-closed): active rules
// need a distinct maker and checker, sane bands, non-negative fee parameters.
func (s FeeSchedule) Validate() error {
	seen := map[string]bool{}
	for _, r := range s.Rules {
		if r.ID == "" || seen[r.ID] {
			return fmt.Errorf("%w: missing or duplicate rule id %q", ErrInvalidSchedule, r.ID)
		}
		seen[r.ID] = true
		if r.Level < LevelUniversal || r.Level > LevelOverride {
			return fmt.Errorf("%w: rule %s has invalid level", ErrInvalidSchedule, r.ID)
		}
		if r.Level >= LevelNegotiated && r.SubjectID == "" {
			return fmt.Errorf("%w: rule %s (override/promo/negotiated) needs a subject", ErrInvalidSchedule, r.ID)
		}
		f := r.Fee
		if f.FlatMinor < 0 || f.PctBPS < 0 || f.MinMinor < 0 || f.MaxMinor < 0 ||
			(f.MaxMinor != 0 && f.MaxMinor < f.MinMinor) {
			return fmt.Errorf("%w: rule %s has invalid fee parameters", ErrInvalidSchedule, r.ID)
		}
		if r.AmountMin < 0 || (r.AmountMax != 0 && r.AmountMax < r.AmountMin) {
			return fmt.Errorf("%w: rule %s has invalid amount band", ErrInvalidSchedule, r.ID)
		}
		switch r.PayerMode {
		case PayerFeeOnTop, PayerFeeIncluded, PayerSplit:
		default:
			return fmt.Errorf("%w: rule %s has invalid payer mode %q", ErrInvalidSchedule, r.ID, r.PayerMode)
		}
		if r.Status == StatusActive && (r.Maker == "" || r.Checker == "" || strings.EqualFold(r.Maker, r.Checker)) {
			return fmt.Errorf("%w: active rule %s needs distinct maker and checker", ErrInvalidSchedule, r.ID)
		}
	}
	return nil
}

// QuoteKind classifies a quote line.
type QuoteKind string

const (
	KindVertoCost   QuoteKind = "VERTO_COST"
	KindPlatformFee QuoteKind = "PLATFORM_FEE"
	KindFXSpread    QuoteKind = "FX_SPREAD"
	KindPassthrough QuoteKind = "PASSTHROUGH"
	KindTax         QuoteKind = "TAX"
)

// QuoteLine is one line item of a quote.
type QuoteLine struct {
	Kind    QuoteKind
	Service string
	Amount  Money
	Payer   Payer
	RuleID  string
	Visible bool
}

// Quote is an immutable snapshot of the priced line items. Fields are
// unexported; accessors return copies.
type Quote struct {
	lines        []QuoteLine
	revenue      Money
	cost         Money
	estProfit    Money
	senderPays   Money
	receiverGets Money
	ruleID       string
	pricedAt     time.Time
}

// Lines returns a copy of the line items.
func (q Quote) Lines() []QuoteLine { return append([]QuoteLine(nil), q.lines...) }

// Revenue is platform fee + FX spread.
func (q Quote) Revenue() Money { return q.revenue }

// Cost is the L0 Verto cost.
func (q Quote) Cost() Money { return q.cost }

// EstProfit is revenue - L0 cost (tax and pass-through excluded).
func (q Quote) EstProfit() Money { return q.estProfit }

// SenderPays is what the customer is charged in total.
func (q Quote) SenderPays() Money { return q.senderPays }

// ReceiverGets is what the beneficiary receives.
func (q Quote) ReceiverGets() Money { return q.receiverGets }

// RuleID is the winning fee rule.
func (q Quote) RuleID() string { return q.ruleID }

// PricedAt is the time the price was resolved for.
func (q Quote) PricedAt() time.Time { return q.pricedAt }

// Typed errors. Callers use errors.Is.
var (
	ErrInvalidInput    = errors.New("pricing: invalid input")
	ErrInvalidSchedule = errors.New("pricing: invalid fee schedule")
	ErrNoRule          = errors.New("pricing: no applicable fee rule")
	ErrAmbiguousRule   = errors.New("pricing: ambiguous fee rules at equal precedence")
	ErrAmbiguousCost   = errors.New("pricing: ambiguous L0 cost rows at equal precedence")
	ErrNoCost          = errors.New("pricing: no L0 cost entry")
	ErrBelowCostFloor  = errors.New("pricing: fee+spread below L0 cost plus floor margin")
	ErrAboveHardCap    = errors.New("pricing: fee+spread above hard cap")
	ErrNoHardCap       = errors.New("pricing: no hard cap configured")
	ErrOverflow        = errors.New("pricing: amount overflow")
)

// GuardrailError carries the offending amount for diagnostics and wraps the
// sentinel (ErrBelowCostFloor / ErrAboveHardCap).
type GuardrailError struct {
	Sentinel     error
	RuleID       string
	AmountMinor  int64
	RevenueMinor int64
	LimitMinor   int64
}

func (e *GuardrailError) Error() string {
	return fmt.Sprintf("%v (rule %s, amount %d, fee+spread %d, limit %d)", e.Sentinel, e.RuleID, e.AmountMinor, e.RevenueMinor, e.LimitMinor)
}

// Unwrap exposes the sentinel for errors.Is.
func (e *GuardrailError) Unwrap() error { return e.Sentinel }
