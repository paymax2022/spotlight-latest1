// Package pricingadmin is the admin console backend for cross-border pricing
// (SP-3a Task 9a): rate card, Platform-Fee schedule (maker-checker + effective
// dating + rollback), spread read/sync diff, fee-collection settings, refund-fee
// policy, guardrails, and the pricing simulator.
//
// Money safety: every amount is int64 minor units; no float anywhere. The
// persisted fee schedule round-trips into pricing.FeeRule/FeeSchedule and the
// simulator calls the SAME pricing.Resolve the live quote path uses, so there
// is exactly one pricing implementation.
package pricingadmin

import (
	"context"
	"errors"
	"strings"
	"time"

	"spotlight/backend/internal/crossborder/pricing"
)

// Rule statuses (persisted).
const (
	StatusPending  = "pending"
	StatusActive   = "active"
	StatusRetired  = "retired"
	StatusRejected = "rejected"
)

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrNotFound        = errors.New("pricingadmin: not found")
	ErrSelfApproval    = errors.New("pricingadmin: maker cannot approve or reject their own change")
	ErrNotPending      = errors.New("pricingadmin: change is not pending")
	ErrInvalid         = errors.New("pricingadmin: invalid request")
	ErrNotConfigured   = errors.New("pricingadmin: pricing guardrails not configured")
	ErrVersionNotFound = errors.New("pricingadmin: version not found")
)

// FeeRuleRecord is one persisted version of a fee rule. It maps 1:1 onto
// pricing.FeeRule via ToFeeRule / FromFeeRule.
type FeeRuleRecord struct {
	ID             string     `json:"id"`
	RuleKey        string     `json:"rule_key"`
	Version        int        `json:"version"`
	Level          int        `json:"level"`
	SubjectID      string     `json:"subject_id"`
	Service        string     `json:"service"`
	Direction      string     `json:"direction"`
	Corridor       string     `json:"corridor"`
	Rail           string     `json:"rail"`
	Currency       string     `json:"currency"`
	Plan           string     `json:"plan"`
	Tier           string     `json:"tier"`
	AmountMin      int64      `json:"amount_min"`
	AmountMax      int64      `json:"amount_max"`
	FlatMinor      int64      `json:"flat_minor"`
	PctBPS         int64      `json:"pct_bps"`
	MinMinor       int64      `json:"min_minor"`
	MaxMinor       int64      `json:"max_minor"`
	PayerMode      string     `json:"payer_mode"`
	EffectiveFrom  *time.Time `json:"effective_from"`
	EffectiveTo    *time.Time `json:"effective_to"`
	Status         string     `json:"status"`
	Maker          string     `json:"maker"`
	Checker        string     `json:"checker,omitempty"`
	Reason         string     `json:"reason"`
	RolledBackFrom string     `json:"rolled_back_from,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	DecidedAt      *time.Time `json:"decided_at,omitempty"`
}

func tz(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

func tp(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

// ToFeeRule converts a persisted record into the resolver's FeeRule. Only
// active records are tradable; pending/rejected map to draft, retired to retired.
func (r FeeRuleRecord) ToFeeRule() pricing.FeeRule {
	st := pricing.StatusDraft
	switch r.Status {
	case StatusActive:
		st = pricing.StatusActive
	case StatusRetired:
		st = pricing.StatusRetired
	}
	return pricing.FeeRule{
		ID: r.ID, Level: pricing.Level(r.Level), SubjectID: r.SubjectID, Service: r.Service,
		Direction: r.Direction, Corridor: r.Corridor, Rail: r.Rail, Currency: r.Currency,
		Plan: r.Plan, Tier: r.Tier, AmountMin: r.AmountMin, AmountMax: r.AmountMax,
		Fee:       pricing.FeeSpec{FlatMinor: r.FlatMinor, PctBPS: r.PctBPS, MinMinor: r.MinMinor, MaxMinor: r.MaxMinor},
		PayerMode: pricing.PayerMode(r.PayerMode),
		ValidFrom: tz(r.EffectiveFrom), ValidTo: tz(r.EffectiveTo),
		Status: st, Maker: r.Maker, Checker: r.Checker,
	}
}

// FromFeeRule is the inverse of ToFeeRule (status is set by the caller).
func FromFeeRule(f pricing.FeeRule) FeeRuleRecord {
	return FeeRuleRecord{
		ID: f.ID, Level: int(f.Level), SubjectID: f.SubjectID, Service: f.Service,
		Direction: f.Direction, Corridor: f.Corridor, Rail: f.Rail, Currency: f.Currency,
		Plan: f.Plan, Tier: f.Tier, AmountMin: f.AmountMin, AmountMax: f.AmountMax,
		FlatMinor: f.Fee.FlatMinor, PctBPS: f.Fee.PctBPS, MinMinor: f.Fee.MinMinor, MaxMinor: f.Fee.MaxMinor,
		PayerMode: string(f.PayerMode), EffectiveFrom: tp(f.ValidFrom), EffectiveTo: tp(f.ValidTo),
		Maker: f.Maker, Checker: f.Checker,
	}
}

// RateCardRow is one persisted L0 cost row. A CostUnknown row is a flag only:
// it is excluded from the resolver's card, so pricing on it fails closed
// (pricing.ErrNoCost) instead of using a guessed cost.
type RateCardRow struct {
	ID          string     `json:"id"`
	Service     string     `json:"service"`
	Corridor    string     `json:"corridor"`
	Rail        string     `json:"rail"`
	Currency    string     `json:"currency"`
	FlatMinor   int64      `json:"flat_minor"`
	PctBPS      int64      `json:"pct_bps"`
	CostUnknown bool       `json:"cost_unknown"`
	ValidFrom   *time.Time `json:"valid_from"`
	ValidTo     *time.Time `json:"valid_to"`
	SourceRef   string     `json:"source_ref"`
	CreatedBy   string     `json:"created_by"`
	UpdatedBy   string     `json:"updated_by"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// ToCostEntry converts to the resolver's CostEntry.
func (r RateCardRow) ToCostEntry() pricing.CostEntry {
	return pricing.CostEntry{Service: r.Service, Corridor: r.Corridor, Rail: r.Rail, Currency: r.Currency, FlatMinor: r.FlatMinor, PctBPS: r.PctBPS}
}

// usableAt reports whether the row prices a request at t.
func (r RateCardRow) usableAt(t time.Time) bool {
	if r.CostUnknown {
		return false
	}
	if r.ValidFrom != nil && t.Before(*r.ValidFrom) {
		return false
	}
	if r.ValidTo != nil && !t.Before(*r.ValidTo) {
		return false
	}
	return true
}

// Guardrails mirrors pricing.Guardrails plus the VAT rate used by the resolver.
type Guardrails struct {
	FloorMarginMinor int64     `json:"floor_margin_minor"`
	FloorMarginBPS   int64     `json:"floor_margin_bps"`
	HardCapBPS       int64     `json:"hard_cap_bps"`
	HardCapMinor     int64     `json:"hard_cap_minor"`
	TaxBPS           int64     `json:"tax_bps"`
	UpdatedBy        string    `json:"updated_by,omitempty"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// CollectionSettings is the fee-collection strategy + sweep schedule.
type CollectionSettings struct {
	Strategy             string    `json:"strategy"` // ledger_charge | ngn_wallet | spread_baked
	SweepIntervalMinutes int       `json:"sweep_interval_minutes"`
	SweepThresholdMinor  int64     `json:"sweep_threshold_minor"`
	UpdatedBy            string    `json:"updated_by,omitempty"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// RefundPolicy says whether the platform fee is refunded or retained.
type RefundPolicy struct {
	OnFailed         string    `json:"on_failed"`
	OnCancelled      string    `json:"on_cancelled"`
	OnCustomerRefund string    `json:"on_customer_refund"`
	UpdatedBy        string    `json:"updated_by,omitempty"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// SpreadRow is one FX spread rule (public.fx_markup_rates / Verto markup config).
type SpreadRow struct {
	Corridor string `json:"corridor"`
	Tier     string `json:"tier"`
	BPS      int    `json:"bps"`
	Active   bool   `json:"active"`
}

func spreadKey(r SpreadRow) string {
	return strings.ToUpper(strings.TrimSpace(r.Corridor)) + "|" + strings.ToLower(strings.TrimSpace(r.Tier))
}

// Store is the persistence port. The pgx implementation is PGStore.
type Store interface {
	ListFeeRules(ctx context.Context, status string) ([]FeeRuleRecord, error)
	GetFeeRule(ctx context.Context, id string) (FeeRuleRecord, error)
	// CreateFeeRuleChange inserts a PENDING version. rec.RuleKey == "" starts a
	// new lineage (version 1); otherwise the next version of that lineage.
	CreateFeeRuleChange(ctx context.Context, rec FeeRuleRecord) (FeeRuleRecord, error)
	// ApproveFeeRule activates a pending change. The store MUST refuse
	// checker == maker (ErrSelfApproval) — defence in depth below the handler.
	ApproveFeeRule(ctx context.Context, id, checker string, now time.Time) (FeeRuleRecord, error)
	RejectFeeRule(ctx context.Context, id, checker string, now time.Time) (FeeRuleRecord, error)
	// RollbackFeeRule creates a new PENDING version copying toVersion of ruleKey.
	RollbackFeeRule(ctx context.Context, ruleKey string, toVersion int, maker, reason string, effectiveFrom time.Time) (FeeRuleRecord, error)
	// ActiveFeeSchedule returns the active rules as the resolver's schedule.
	ActiveFeeSchedule(ctx context.Context) (pricing.FeeSchedule, error)

	ListRateCard(ctx context.Context) ([]RateCardRow, error)
	CreateRateCard(ctx context.Context, row RateCardRow) (RateCardRow, error)
	UpdateRateCard(ctx context.Context, row RateCardRow) (RateCardRow, error)
	ExpireRateCard(ctx context.Context, id, by string, at time.Time) (RateCardRow, error)

	GetGuardrails(ctx context.Context) (Guardrails, bool, error)
	PutGuardrails(ctx context.Context, g Guardrails, by string) (Guardrails, error)
	GetCollection(ctx context.Context) (CollectionSettings, error)
	PutCollection(ctx context.Context, s CollectionSettings, by string) (CollectionSettings, error)
	GetRefundPolicy(ctx context.Context) (RefundPolicy, error)
	PutRefundPolicy(ctx context.Context, p RefundPolicy, by string) (RefundPolicy, error)
}

// SpreadSupplier gives the simulator the same spread source the live quote uses
// (refreshed from public.fx_markup_rates) and lists the local spread rules.
type SpreadSupplier interface {
	Source(ctx context.Context) (pricing.SpreadSource, error)
	Rules(ctx context.Context) ([]SpreadRow, error)
}

// VertoMarkupReader reads the markup config currently held at Verto
// (/fx/markup/config). May be nil: the sync status is then "unavailable".
type VertoMarkupReader interface {
	MarkupConfig(ctx context.Context) ([]SpreadRow, error)
}

// BuildRateCard turns persisted rows into the resolver's card, dropping
// cost-unknown and out-of-validity rows (fail closed).
func BuildRateCard(rows []RateCardRow, at time.Time) pricing.RateCard {
	var rc pricing.RateCard
	for _, r := range rows {
		if r.usableAt(at) {
			rc.Entries = append(rc.Entries, r.ToCostEntry())
		}
	}
	return rc
}
