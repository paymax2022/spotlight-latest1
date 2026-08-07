package commission

import (
	"context"
	"errors"
	"fmt"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// ledgerService is the minimal slice of the finance ledger this module needs to
// recognize realized revenue. Kept as an interface so the module stays nil-safe
// (ledger posting is best-effort) and independently testable.
type ledgerService interface {
	GetOrCreateStandingAccount(ctx context.Context, accountType ledger.AccountType) (*ledger.Account, error)
	PostJournal(ctx context.Context, j ledger.JournalEntry) error
}

// Service holds the commission business logic: rate resolution + fee math,
// audited config mutation, idempotent earning recognition, and profit reports.
type Service struct {
	repo   *Repository
	ledger ledgerService // optional; nil ⇒ earnings recorded without a ledger post
}

// NewService builds the service. ledgerSvc may be nil (ledger posting becomes a
// best-effort no-op, the earning row is still recorded).
func NewService(repo *Repository, ledgerSvc ledgerService) *Service {
	return &Service{repo: repo, ledger: ledgerSvc}
}

// ── config reads ─────────────────────────────────────────────────────────────

// ListConfig returns configs (optionally filtered) for the admin rate-card view.
func (s *Service) ListConfig(ctx context.Context, category string, activeOnly bool) ([]Config, error) {
	return s.repo.ListConfig(ctx, category, activeOnly)
}

// GetConfig fetches a config by id.
func (s *Service) GetConfig(ctx context.Context, id string) (*Config, error) {
	return s.repo.GetByID(ctx, id)
}

// ── calculation ──────────────────────────────────────────────────────────────

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

// ── audited config mutation ──────────────────────────────────────────────────

// CreateConfig upserts a config row and appends a create/update audit entry.
func (s *Service) CreateConfig(ctx context.Context, in ConfigInput, changedBy string) (*Config, error) {
	// Capture prior state (if this collides with an existing key) for the audit.
	var before map[string]any
	if existing, err := s.repo.GetByKey(ctx, in.ServiceCategory, in.Service, in.ServiceSubtype); err == nil {
		before = configToMap(existing)
	} else if !errors.Is(err, ErrConfigNotFound) {
		return nil, err
	}

	by := ptrOrNil(changedBy)
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
	by := ptrOrNil(changedBy)
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
	by := ptrOrNil(changedBy)
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

// ── earning recognition ──────────────────────────────────────────────────────

// RecordEarning idempotently records realized Spotlight profit for one source
// transaction. The fee breakdown is derived server-side from the active config
// (never trusted from the caller). If a ledger service is wired and the spotlight
// revenue is positive, a balanced double-entry recognition is posted FIRST
// (DR provider_clearing → CR commission-revenue) so the immutable earning row can
// carry the ledger_ref (the append-only table forbids a later UPDATE). Both the
// ledger post and the earnings insert are keyed by the idempotency key, so a
// duplicate call is a safe no-op that returns the original row.
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

	// Recognize revenue in the ledger BEFORE persisting the (immutable) earning so
	// we can store its ledger_ref. Idempotent + best-effort: a duplicate is a safe
	// no-op; a ledger failure must not corrupt the ledger, so we surface the error
	// and do NOT record an earning that claims a ledger ref it never got.
	if s.ledger != nil && bd.SpotlightRevenueKobo > 0 {
		ref := "commission:" + idempotencyKey
		if err := s.postRevenue(ctx, ref, idempotencyKey+":commission-rev", bd.SpotlightRevenueKobo); err != nil {
			return nil, fmt.Errorf("commission: recognize revenue: %w", err)
		}
		e.LedgerRef = &ref
	}

	saved, _, err := s.repo.InsertEarning(ctx, e)
	if err != nil {
		return nil, err
	}
	return saved, nil
}

// RecordExact idempotently records realized Spotlight profit using the caller's
// ACTUAL realized fee (recordedRevenueKobo) rather than recomputing the breakdown
// from the active config %. This is the correct path for modules whose real earning
// is a FIXED-kobo fee or a provider spread — Money Transfer, FX, Jobs, Association,
// and the Savings early-withdrawal penalty — where config% × gross would mis-state
// profit. (%-take modules keep using RecordEarning/RecordFor.)
//
// The config is still resolved best-effort so config_id + currency are populated for
// reporting joins, but the amount NEVER depends on the config %; a missing config is
// not an error. recordedRevenueKobo is written verbatim to spotlight_revenue_kobo and
// attributed to platform_charge_kobo (these modules realize a platform fee/spread,
// not a provider commission) so the breakdown columns still sum to spotlight_revenue.
// Idempotent on idempotencyKey exactly like RecordEarning (a duplicate is a safe
// no-op that returns the original row). With a nil ledger (as the module adapters use)
// no ledger post is made — the immutable earning row is appended only (no double count).
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

	// Resolve config best-effort — ONLY for config_id + currency (reporting joins). The
	// recorded amount is the caller's realized fee and never depends on the config %, so
	// a missing config is fine (config_id stays nil, currency defaults to NGN).
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

	// Recognize revenue in the ledger BEFORE persisting the immutable earning (same
	// order + idempotency discipline as RecordEarning) when a ledger is wired and the
	// realized fee is positive. These module adapters inject a nil ledger, so this is a
	// no-op there and only the earning row is appended.
	if s.ledger != nil && recordedRevenueKobo > 0 {
		ref := "commission:" + idempotencyKey
		if err := s.postRevenue(ctx, ref, idempotencyKey+":commission-rev", recordedRevenueKobo); err != nil {
			return nil, fmt.Errorf("commission: recognize revenue: %w", err)
		}
		e.LedgerRef = &ref
	}

	saved, _, err := s.repo.InsertEarning(ctx, e)
	if err != nil {
		return nil, err
	}
	return saved, nil
}

// postRevenue posts a balanced revenue-recognition entry:
//
//	DR provider_clearing  (funds received on behalf of Spotlight are drawn down)
//	CR commission         (Spotlight commission-revenue account)
//
// Both are standing accounts resolved via GetOrCreateStandingAccount (singletons
// by type; auto-created, no seed row needed). This mirrors how other revenue
// modules recognize income (e.g. placement: DR escrow → CR placement_revenue;
// creators: fee moves into paymax_revenue). Idempotent via the ledger's unique
// idempotency_key + Redis fast-path — a duplicate is a safe no-op.
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

// ── reports ──────────────────────────────────────────────────────────────────

// ProfitReport aggregates realized earnings over [from,to) grouped by
// "category", "service", or "day".
func (s *Service) ProfitReport(ctx context.Context, from, to time.Time, groupBy string) ([]ReportRow, error) {
	return s.repo.Report(ctx, from, to, groupBy)
}

// ListEarnings returns raw earning rows over [from,to) filtered by category.
func (s *Service) ListEarnings(ctx context.Context, from, to time.Time, category string, limit int) ([]Earning, error) {
	return s.repo.ListEarnings(ctx, from, to, category, limit)
}

// ── helpers ──────────────────────────────────────────────────────────────────

func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
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
