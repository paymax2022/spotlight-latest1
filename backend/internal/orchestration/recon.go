package orchestration

import (
	"context"
	"sort"
	"time"
)

// SettlementRecord is one line from a provider's settlement report (spec §8).
// Amounts are minor units in the settled (source) currency.
type SettlementRecord struct {
	Reference    string
	Provider     string
	AmountMinor  int64
	FeeMinor     int64
	Currency     string
	SettledAt    time.Time
}

// SettlementSource yields a provider's settlement report for reconciliation.
// Production: a per-provider adapter that pulls the daily settlement file/API.
type SettlementSource interface {
	Settlements(ctx context.Context, provider string, day time.Time) ([]SettlementRecord, error)
}

// ReconBreakKind classifies a discrepancy.
type ReconBreakKind string

const (
	BreakAmount  ReconBreakKind = "amount"
	BreakFee     ReconBreakKind = "fee"
	BreakMissing ReconBreakKind = "missing"   // in ledger, absent from settlement
	BreakOrphan  ReconBreakKind = "orphan"    // in settlement, absent from ledger
)

// ReconBreak is a single reconciliation discrepancy surfaced to ops (spec §8/§13-I).
type ReconBreak struct {
	Reference     string         `json:"reference"`
	Provider      string         `json:"provider"`
	Kind          ReconBreakKind `json:"kind"`
	ExpectedMinor int64          `json:"expected_minor"`
	ActualMinor   int64          `json:"actual_minor"`
	Currency      string         `json:"currency"`
	Detail        string         `json:"detail"`
}

// ReconReport is the outcome of a reconciliation run.
type ReconReport struct {
	Provider  string       `json:"provider"`
	RunAt     time.Time    `json:"run_at"`
	Matched   int          `json:"matched"`
	Breaks    []ReconBreak `json:"breaks"`
	SpreadMinor int64      `json:"spread_minor"` // proven margin captured this run
}

// ledgerSettlementSource derives settlement records from the unified ledger.
// It is the clean-baseline source used until a real per-provider settlement
// feed is wired (swap it for a provider adapter that pulls the daily file/API).
type ledgerSettlementSource struct{ store Store }

// NewLedgerSettlementSource builds a SettlementSource backed by the ledger.
func NewLedgerSettlementSource(store Store) SettlementSource {
	return &ledgerSettlementSource{store: store}
}

func (l *ledgerSettlementSource) Settlements(ctx context.Context, provider string, _ time.Time) ([]SettlementRecord, error) {
	convs, err := l.store.AllConversions(ctx)
	if err != nil {
		return nil, err
	}
	transfers, err := l.store.AllTransfers(ctx)
	if err != nil {
		return nil, err
	}
	var out []SettlementRecord
	for _, c := range convs {
		if c.Route.Provider == provider {
			leg := legFromConversion(c)
			out = append(out, SettlementRecord{Reference: c.Reference, Provider: provider, AmountMinor: leg.amount, FeeMinor: leg.fee, Currency: leg.currency})
		}
	}
	for _, t := range transfers {
		if t.Route.Provider == provider {
			leg := legFromTransfer(t)
			out = append(out, SettlementRecord{Reference: t.Reference, Provider: provider, AmountMinor: leg.amount, FeeMinor: leg.fee, Currency: leg.currency})
		}
	}
	return out, nil
}

// ledgerLeg is the normalized view of a ledger entry used for matching.
type ledgerLeg struct {
	reference string
	provider  string
	amount    int64 // source minor (you-send)
	fee       int64 // provider+rail fees in source minor
	currency  string
	spread    int64 // paymax_spread in source minor
}

func legFromConversion(c *Conversion) ledgerLeg {
	return ledgerLeg{
		reference: c.Reference, provider: c.Route.Provider, amount: c.Source.AmountMinor,
		fee:       feeAmount(c.Fees, FeeProvider) + feeAmount(c.Fees, FeeRail),
		currency:  c.Source.Currency, spread: feeAmount(c.Fees, FeeSpread),
	}
}

func legFromTransfer(t *Transfer) ledgerLeg {
	return ledgerLeg{
		reference: t.Reference, provider: t.Route.Provider, amount: t.Source.AmountMinor,
		fee:       feeAmount(t.Fees, FeeProvider) + feeAmount(t.Fees, FeeRail),
		currency:  t.Source.Currency, spread: feeAmount(t.Fees, FeeSpread),
	}
}

// Reconcile matches the unified ledger for one provider against its settlement
// report, surfacing amount/fee/missing/orphan breaks and proving spread margin.
func (s *Service) Reconcile(ctx context.Context, provider string, settlements []SettlementRecord) (*ReconReport, error) {
	convs, err := s.store.AllConversions(ctx)
	if err != nil {
		return nil, err
	}
	transfers, err := s.store.AllTransfers(ctx)
	if err != nil {
		return nil, err
	}

	legs := map[string]ledgerLeg{}
	for _, c := range convs {
		if c.Route.Provider == provider {
			legs[c.Reference] = legFromConversion(c)
		}
	}
	for _, t := range transfers {
		if t.Route.Provider == provider {
			legs[t.Reference] = legFromTransfer(t)
		}
	}

	report := &ReconReport{Provider: provider, RunAt: s.now()}
	seen := map[string]bool{}

	for _, rec := range settlements {
		seen[rec.Reference] = true
		leg, ok := legs[rec.Reference]
		if !ok {
			report.Breaks = append(report.Breaks, ReconBreak{
				Reference: rec.Reference, Provider: provider, Kind: BreakOrphan,
				ExpectedMinor: 0, ActualMinor: rec.AmountMinor, Currency: rec.Currency,
				Detail: "settlement record has no matching ledger entry",
			})
			continue
		}
		if leg.amount != rec.AmountMinor {
			report.Breaks = append(report.Breaks, ReconBreak{
				Reference: rec.Reference, Provider: provider, Kind: BreakAmount,
				ExpectedMinor: leg.amount, ActualMinor: rec.AmountMinor, Currency: leg.currency,
				Detail: "settled amount differs from ledger",
			})
			continue
		}
		if leg.fee != rec.FeeMinor {
			report.Breaks = append(report.Breaks, ReconBreak{
				Reference: rec.Reference, Provider: provider, Kind: BreakFee,
				ExpectedMinor: leg.fee, ActualMinor: rec.FeeMinor, Currency: leg.currency,
				Detail: "provider fee differs from ledger",
			})
			continue
		}
		report.Matched++
		report.SpreadMinor += leg.spread
	}

	// Ledger entries with no settlement record yet.
	refs := make([]string, 0, len(legs))
	for ref := range legs {
		refs = append(refs, ref)
	}
	sort.Strings(refs)
	for _, ref := range refs {
		if !seen[ref] {
			leg := legs[ref]
			report.Breaks = append(report.Breaks, ReconBreak{
				Reference: ref, Provider: provider, Kind: BreakMissing,
				ExpectedMinor: leg.amount, ActualMinor: 0, Currency: leg.currency,
				Detail: "ledger entry not present in settlement report",
			})
		}
	}

	// Emit a recon.completed event for the ops console / on-call.
	s.emit(ctx, "recon.completed", report)
	return report, nil
}

// RunDailyReconciliation pulls settlements from the source and reconciles every
// configured provider for the given day.
func (s *Service) RunDailyReconciliation(ctx context.Context, src SettlementSource, day time.Time) ([]*ReconReport, error) {
	var reports []*ReconReport
	for _, p := range s.order {
		recs, err := src.Settlements(ctx, p.Name(), day)
		if err != nil {
			continue // skip a provider whose feed is unavailable; others still reconcile
		}
		rep, err := s.Reconcile(ctx, p.Name(), recs)
		if err != nil {
			return reports, err
		}
		reports = append(reports, rep)
	}
	return reports, nil
}
