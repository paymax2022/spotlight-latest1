package commission

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/ledger"
)

// ledgerService is the minimal slice of the finance ledger this module needs to
// recognize realized revenue. Kept as an interface so the module stays nil-safe
// (ledger posting is best-effort) and independently testable.
type ledgerService interface {
	GetOrCreateStandingAccount(ctx context.Context, accountType ledger.AccountType) (*ledger.Account, error)
	PostJournal(ctx context.Context, j ledger.JournalEntry) error
}

// ReferralHook is notified once per NEWLY recorded earning — the seam the
// referral commission-split engine hangs off (it imports this package, never
// the reverse — no cycle). It must never be allowed to fail the caller's
// purchase — see Service.SetReferralHook.
type ReferralHook interface {
	OnEarningRecorded(ctx context.Context, e Earning)
}

// Service holds the commission business logic: rate resolution + fee math,
// audited config mutation, idempotent earning recognition, and profit reports.
type Service struct {
	repo         *Repository
	ledger       ledgerService // optional; nil ⇒ earnings recorded without a ledger post
	referralHook ReferralHook  // optional; nil ⇒ no referral commission-split
}

// NewService builds the service. ledgerSvc may be nil (ledger posting becomes a
// best-effort no-op, the earning row is still recorded).
func NewService(repo *Repository, ledgerSvc ledgerService) *Service {
	return &Service{repo: repo, ledger: ledgerSvc}
}

// SetReferralHook wires the referral purchase-commission-split engine in after
// construction (main.go builds ledgerSvc/commissionSvc before the referral
// engine exists — see SetResolvers on ledger.Service for the same reason).
// Nil-safe: never wiring one is a valid, pre-existing state (referral split
// simply never fires).
func (s *Service) SetReferralHook(h ReferralHook) { s.referralHook = h }

// notifyReferralHook fires ONLY when InsertEarning reports a genuinely NEW row
// (exactly once per real earning — never on a replay duplicate). A hook panic
// is recovered so the newer referral engine can never take down a purchase.
func (s *Service) notifyReferralHook(ctx context.Context, e *Earning) {
	if s.referralHook == nil || e == nil {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("commission: referral hook panicked (earning=%s): %v", e.ID, r)
		}
	}()
	s.referralHook.OnEarningRecorded(ctx, *e)
}

// ListConfig returns configs (optionally filtered) for the admin rate-card view.
func (s *Service) ListConfig(ctx context.Context, category string, activeOnly bool) ([]Config, error) {
	return s.repo.ListConfig(ctx, category, activeOnly)
}

// GetConfig fetches a config by id.
func (s *Service) GetConfig(ctx context.Context, id string) (*Config, error) {
	return s.repo.GetByID(ctx, id)
}

// Calculate resolves the active config (with subtype→service-level fallback) and
// computes the full fee breakdown for grossKobo. All math is integer kobo/bps
// with floor division; no floats ever touch a money value.
func (s *Service) Calculate(ctx context.Context, category, service, subtype string, grossKobo int64) (*CalcResult, error) {
	if grossKobo < 0 {
		return nil, fmt.Errorf("commission: gross amount must be non-negative, got %d", grossKobo)
	}
	cfg, err := s.repo.GetByKey(ctx, category, service, subtype)
	if err != nil {
		return nil, err
	}
	res := computeBreakdown(cfg, grossKobo)
	return res, nil
}

// computeBreakdown is the pure fee-math core (no I/O) so it is trivially testable
// and can never diverge between the Calculate endpoint and RecordEarning.
func computeBreakdown(cfg *Config, grossKobo int64) *CalcResult {
	commission := grossKobo * cfg.CommissionBps / 10000         // floor division
	platformCharge := grossKobo * cfg.PlatformChargeBps / 10000 // floor division
	convenience := cfg.ConvenienceFeeKobo
	fixed := cfg.FixedFeeKobo

	spotlightRevenue := commission + platformCharge + convenience + fixed

	// The customer always bears convenience + fixed fees. The platform charge is
	// only added to the customer total when the fee_payer is the customer;
	// otherwise it is borne by the provider/merchant out of the gross.
	customerTotal := grossKobo + convenience + fixed
	if cfg.FeePayer == FeePayerCustomer {
		customerTotal += platformCharge
	}

	return &CalcResult{
		ConfigID:             cfg.ID,
		ServiceCategory:      cfg.ServiceCategory,
		Service:              cfg.Service,
		ServiceSubtype:       cfg.ServiceSubtype,
		FeeModel:             cfg.FeeModel,
		FeePayer:             cfg.FeePayer,
		Currency:             cfg.Currency,
		GrossAmountKobo:      grossKobo,
		CommissionKobo:       commission,
		PlatformChargeKobo:   platformCharge,
		ConvenienceFeeKobo:   convenience,
		FixedFeeKobo:         fixed,
		SpotlightRevenueKobo: spotlightRevenue,
		CustomerTotalKobo:    customerTotal,
	}
}

// CreateConfig upserts a config row and appends a create/update audit entry.
func (s *Service) CreateConfig(ctx context.Context, in ConfigInput, changedBy string) (*Config, error) {
	// Prior state (on a key collision) for the before/after audit payload.
	var before map[string]any
	if existing, err := s.repo.GetByKey(ctx, in.ServiceCategory, in.Service, in.ServiceSubtype); err == nil {
		before = configToMap(existing)
	} else if !errors.Is(err, ErrConfigNotFound) {
		return nil, err
	}

	by := ptr.OrNil(changedBy)
	saved, err := s.repo.UpsertConfig(ctx, in, by)
	if err != nil {
		return nil, err
	}
	action := "create"
	if before != nil {
		action = "update"
	}
	_ = s.repo.InsertAudit(ctx, saved.ID, action, before, configToMap(saved), by)
	return saved, nil
}

// UpdateConfig updates rates for an existing config by id and audits before/after.
func (s *Service) UpdateConfig(ctx context.Context, id string, in ConfigInput, changedBy string) (*Config, error) {
	before, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	by := ptr.OrNil(changedBy)
	saved, err := s.repo.UpdateConfigByID(ctx, id, in, by)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, saved.ID, "update", configToMap(before), configToMap(saved), by)
	return saved, nil
}

// SetActive activates/deactivates a config and audits the toggle.
func (s *Service) SetActive(ctx context.Context, id string, active bool, changedBy string) (*Config, error) {
	before, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	by := ptr.OrNil(changedBy)
	saved, err := s.repo.SetActive(ctx, id, active, by)
	if err != nil {
		return nil, err
	}
	action := "deactivate"
	if active {
		action = "activate"
	}
	_ = s.repo.InsertAudit(ctx, saved.ID, action, configToMap(before), configToMap(saved), by)
	return saved, nil
}

// RecordEarning idempotently records realized Spotlight profit for one source
// transaction. The fee breakdown is derived server-side (never trusted from
// the caller). When a ledger is wired and revenue is positive, the balanced
// recognition (DR provider_clearing → CR commission-revenue) posts FIRST so the
// immutable earning row can carry ledger_ref. Both the post and the insert key
// on the idempotency key — a duplicate is a safe no-op returning the original.
func (s *Service) RecordEarning(ctx context.Context, in EarningInput, idempotencyKey string) (*Earning, error) {
	if idempotencyKey == "" {
		return nil, errors.New("commission: idempotency key required")
	}
	if in.GrossAmountKobo < 0 {
		return nil, fmt.Errorf("commission: gross amount must be non-negative, got %d", in.GrossAmountKobo)
	}

	cfg, err := s.repo.GetByKey(ctx, in.ServiceCategory, in.Service, in.ServiceSubtype)
	if err != nil {
		return nil, err
	}
	bd := computeBreakdown(cfg, in.GrossAmountKobo)

	currency := in.Currency
	if currency == "" {
		currency = cfg.Currency
	}

	e := &Earning{
		ConfigID:             &cfg.ID,
		ServiceCategory:      cfg.ServiceCategory,
		Service:              cfg.Service,
		ServiceSubtype:       cfg.ServiceSubtype,
		GrossAmountKobo:      in.GrossAmountKobo,
		CommissionKobo:       bd.CommissionKobo,
		PlatformChargeKobo:   bd.PlatformChargeKobo,
		ConvenienceFeeKobo:   bd.ConvenienceFeeKobo,
		FixedFeeKobo:         bd.FixedFeeKobo,
		SpotlightRevenueKobo: bd.SpotlightRevenueKobo,
		Currency:             currency,
		SourceModule:         in.SourceModule,
		SourceRef:            in.SourceRef,
		UserID:               in.UserID,
		IdempotencyKey:       &idempotencyKey,
	}

	// Ledger recognition BEFORE persisting so the immutable row carries
	// ledger_ref; a failure surfaces rather than recording a phantom ref.
	if s.ledger != nil && bd.SpotlightRevenueKobo > 0 {
		ref := "commission:" + idempotencyKey
		if err := s.postRevenue(ctx, ref, idempotencyKey+":commission-rev", bd.SpotlightRevenueKobo); err != nil {
			return nil, fmt.Errorf("commission: recognize revenue: %w", err)
		}
		e.LedgerRef = &ref
	}

	saved, inserted, err := s.repo.InsertEarning(ctx, e)
	if err != nil {
		return nil, err
	}
	if inserted {
		s.notifyReferralHook(ctx, saved)
	}
	return saved, nil
}

// RecordExact idempotently records realized profit using the caller's ACTUAL
// realized fee (recordedRevenueKobo) rather than config% × gross — the correct
// path for fixed-fee / spread modules (transfers, FX, jobs, association,
// savings early-withdrawal penalty). recordedRevenueKobo lands verbatim on
// spotlight_revenue_kobo, attributed to platform_charge_kobo so the breakdown
// columns still sum. Config resolution is best-effort for reporting joins only
// (a missing config is not an error). Idempotent like RecordEarning; with a
// nil ledger (the module adapters) only the earning row is appended.
func (s *Service) RecordExact(ctx context.Context, category, service, subtype string,
	grossKobo, recordedRevenueKobo int64, sourceModule, sourceRef string, userID *string, idempotencyKey string) (*Earning, error) {
	if idempotencyKey == "" {
		return nil, errors.New("commission: idempotency key required")
	}
	if grossKobo < 0 {
		return nil, fmt.Errorf("commission: gross amount must be non-negative, got %d", grossKobo)
	}
	if recordedRevenueKobo < 0 {
		return nil, fmt.Errorf("commission: recorded revenue must be non-negative, got %d", recordedRevenueKobo)
	}

	// Config resolution is for config_id + currency only — the recorded amount
	// never depends on config %.
	var configID *string
	currency := "NGN"
	if cfg, err := s.repo.GetByKey(ctx, category, service, subtype); err == nil {
		configID = &cfg.ID
		if cfg.Currency != "" {
			currency = cfg.Currency
		}
	} else if !errors.Is(err, ErrConfigNotFound) {
		return nil, err
	}

	e := &Earning{
		ConfigID:             configID,
		ServiceCategory:      category,
		Service:              service,
		ServiceSubtype:       subtype,
		GrossAmountKobo:      grossKobo,
		CommissionKobo:       0,
		PlatformChargeKobo:   recordedRevenueKobo, // exact realized platform fee/spread
		ConvenienceFeeKobo:   0,
		FixedFeeKobo:         0,
		SpotlightRevenueKobo: recordedRevenueKobo,
		Currency:             currency,
		SourceModule:         sourceModule,
		SourceRef:            sourceRef,
		UserID:               userID,
		IdempotencyKey:       &idempotencyKey,
	}

	// Same order + idempotency discipline as RecordEarning. The module adapters
	// inject a nil ledger, so this is a no-op there.
	if s.ledger != nil && recordedRevenueKobo > 0 {
		ref := "commission:" + idempotencyKey
		if err := s.postRevenue(ctx, ref, idempotencyKey+":commission-rev", recordedRevenueKobo); err != nil {
			return nil, fmt.Errorf("commission: recognize revenue: %w", err)
		}
		e.LedgerRef = &ref
	}

	saved, inserted, err := s.repo.InsertEarning(ctx, e)
	if err != nil {
		return nil, err
	}
	if inserted {
		s.notifyReferralHook(ctx, saved)
	}
	return saved, nil
}

// postRevenue posts a balanced revenue-recognition entry:
//
//	DR provider_clearing  (funds held on behalf of Spotlight drawn down)
//	CR commission         (Spotlight commission-revenue account)
//
// Idempotent via the ledger's unique idempotency_key — a duplicate is a no-op.
func (s *Service) postRevenue(ctx context.Context, reference, idempotencyKey string, amountKobo int64) error {
	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	revenue, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return err
	}
	err = s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  clearing.ID,
		CreditAccountID: revenue.ID,
		Description:     "commission revenue recognition",
	})
	if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	return nil
}

// ProfitReport aggregates realized earnings over [from,to) grouped by
// "category", "service", or "day".
func (s *Service) ProfitReport(ctx context.Context, from, to time.Time, groupBy string) ([]ReportRow, error) {
	return s.repo.Report(ctx, from, to, groupBy)
}

// ListEarnings returns raw earning rows over [from,to) filtered by category.
func (s *Service) ListEarnings(ctx context.Context, from, to time.Time, category string, limit int) ([]Earning, error) {
	return s.repo.ListEarnings(ctx, from, to, category, limit)
}

// configToMap snapshots a config for the before/after jsonb audit payload.
func configToMap(c *Config) map[string]any {
	if c == nil {
		return nil
	}
	return map[string]any{
		"id":                   c.ID,
		"service_category":     c.ServiceCategory,
		"service":              c.Service,
		"service_subtype":      c.ServiceSubtype,
		"fee_model":            c.FeeModel,
		"commission_bps":       c.CommissionBps,
		"platform_charge_bps":  c.PlatformChargeBps,
		"convenience_fee_kobo": c.ConvenienceFeeKobo,
		"fixed_fee_kobo":       c.FixedFeeKobo,
		"fee_payer":            c.FeePayer,
		"currency":             c.Currency,
		"active":               c.Active,
		"notes":                c.Notes,
	}
}

// Recorder is the dependency-light seam other modules use to record realized
// profit into the central registry without importing this module's internals.
// *Service satisfies it; a nil Recorder is a no-op on the caller's side.
type Recorder interface {
	// Record idempotently records realized profit for one source transaction;
	// a straight pass-through to RecordEarning.
	Record(ctx context.Context, in EarningInput, idempotencyKey string) (*Earning, error)

	// RecordFor is the convenience form: the caller passes config coordinates +
	// gross + provenance + idempotency key; the breakdown comes from the active
	// rate card via RecordEarning.
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) (*Earning, error)

	// RecordExact is the exact-fee form for fixed-fee / spread modules
	// (transfers, fx, jobs, association, savings): the caller's realized fee is
	// recorded verbatim — NOT config% × gross. Idempotent like Record.
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) (*Earning, error)
}

// Record satisfies Recorder — a verbatim delegate to RecordEarning.
func (s *Service) Record(ctx context.Context, in EarningInput, idempotencyKey string) (*Earning, error) {
	return s.RecordEarning(ctx, in, idempotencyKey)
}

// RecordFor builds the EarningInput from the caller's coordinates and delegates
// to RecordEarning (the same computeBreakdown core /calculate uses).
func (s *Service) RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceModule, sourceRef string, userID *string, idempotencyKey string) (*Earning, error) {
	return s.RecordEarning(ctx, EarningInput{
		ServiceCategory: category,
		Service:         service,
		ServiceSubtype:  subtype,
		GrossAmountKobo: grossKobo,
		SourceModule:    sourceModule,
		SourceRef:       sourceRef,
		UserID:          userID,
	}, idempotencyKey)
}

// Compile-time assertion that *Service implements the Recorder seam.
var _ Recorder = (*Service)(nil)

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
