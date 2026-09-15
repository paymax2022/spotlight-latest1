package utilitybills_test

// Money invariants for the Utility Bills domain, asserted with ZERO I/O.
//
// These are the properties that must hold for every possible input, not just the
// fixtures the live-DB suite happens to drive. They run on every PR with no
// database, which is the point: a pricing or state-machine regression should fail
// in CI in under a second, not on a UAT environment three days later.

import (
	"errors"
	"testing"

	"spotlight/backend/internal/utilitybills"
)

func kobo(v int64) *int64 { return &v }

// ── INVARIANT 1: retail = amount + markup + convenience fee ─────────────────
//
// This is the sum the WALLET IS DEBITED FOR. If it ever drifts from its parts,
// the member is charged an amount no line item explains.

func TestInvariant_RetailIsExactlySumOfParts(t *testing.T) {
	cases := []struct {
		name       string
		product    utilitybills.Product
		mapping    utilitybills.ProviderMapping
		amountKobo *int64
	}{
		{
			name: "variable electricity with fee and markup",
			product: utilitybills.Product{
				AmountType:    utilitybills.AmountTypeVariable,
				MinAmountKobo: kobo(100_000), MaxAmountKobo: kobo(10_000_000),
				MarkupBps: 150, ConvenienceFeeKobo: 10_000, ProviderDiscountBps: 200,
			},
			mapping:    utilitybills.ProviderMapping{Status: utilitybills.MappingStatusActive, ProviderDiscountBps: 200},
			amountKobo: kobo(500_000),
		},
		{
			name: "fixed data bundle, no fee, no markup",
			product: utilitybills.Product{
				AmountType: utilitybills.AmountTypeFixed, AmountKobo: kobo(50_000),
				ProviderDiscountBps: 500,
			},
			mapping: utilitybills.ProviderMapping{Status: utilitybills.MappingStatusActive, ProviderDiscountBps: 500},
		},
		{
			name: "odd amount that truncates the markup",
			product: utilitybills.Product{
				AmountType: utilitybills.AmountTypeVariable,
				MarkupBps:  333, ConvenienceFeeKobo: 1, ProviderDiscountBps: 111,
			},
			mapping:    utilitybills.ProviderMapping{Status: utilitybills.MappingStatusActive, ProviderDiscountBps: 111},
			amountKobo: kobo(100_001),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := utilitybills.CalculateUtilityPricing(tc.product, tc.mapping, tc.amountKobo)
			if err != nil {
				t.Fatalf("pricing: %v", err)
			}
			if got, want := p.RetailAmountKobo, p.AmountKobo+p.MarkupKobo+p.ConvenienceFeeKobo; got != want {
				t.Fatalf("retail %d != amount %d + markup %d + fee %d (= %d)",
					got, p.AmountKobo, p.MarkupKobo, p.ConvenienceFeeKobo, want)
			}
			if got, want := p.GrossProfitKobo, p.RetailAmountKobo-p.ProviderCostKobo; got != want {
				t.Fatalf("gross profit %d != retail %d - provider cost %d (= %d)",
					got, p.RetailAmountKobo, p.ProviderCostKobo, want)
			}
		})
	}
}

// ── INVARIANT 2: every priced amount is a positive integer ──────────────────

func TestInvariant_PricingRejectsNonPositiveAmounts(t *testing.T) {
	product := utilitybills.Product{AmountType: utilitybills.AmountTypeVariable, ProviderDiscountBps: 100}
	mapping := utilitybills.ProviderMapping{Status: utilitybills.MappingStatusActive}

	for _, amount := range []int64{0, -1, -500_000} {
		if _, err := utilitybills.CalculateUtilityPricing(product, mapping, kobo(amount)); !errors.Is(err, utilitybills.ErrInvalidAmount) {
			t.Fatalf("amount %d: got %v, want ErrInvalidAmount", amount, err)
		}
	}
	// A variable product with NO amount must be refused, not defaulted to zero.
	if _, err := utilitybills.CalculateUtilityPricing(product, mapping, nil); !errors.Is(err, utilitybills.ErrAmountRequired) {
		t.Fatalf("missing amount: got %v, want ErrAmountRequired", err)
	}
}

// ── INVARIANT 3: a non-positive provider cost is refused outright ───────────
//
// A zero or negative provider cost means we would be recording a purchase we
// apparently paid nothing (or were paid) for. That is a catalogue
// misconfiguration, and letting it through would corrupt every margin report
// downstream.

func TestInvariant_NonPositiveProviderCostIsRefused(t *testing.T) {
	product := utilitybills.Product{AmountType: utilitybills.AmountTypeFixed, AmountKobo: kobo(50_000)}
	for _, cost := range []int64{0, -1} {
		mapping := utilitybills.ProviderMapping{
			Status:           utilitybills.MappingStatusActive,
			ProviderCostKobo: kobo(cost),
		}
		if _, err := utilitybills.CalculateUtilityPricing(product, mapping, nil); !errors.Is(err, utilitybills.ErrProviderCostNotPositive) {
			t.Fatalf("cost %d: got %v, want ErrProviderCostNotPositive", cost, err)
		}
	}
}

// ── INVARIANT 4: a pending provider outcome NEVER becomes 'failed' ──────────
//
// The single most expensive mistake this module could make. A timeout or a
// "processing" answer means VTpass may still deliver; mapping it to 'failed'
// triggers the auto-reverse and hands the member both the electricity and a
// refund. status.ts encodes this and the port must not drift from it.

func TestInvariant_PendingNeverBecomesFailed(t *testing.T) {
	if got := utilitybills.NextStatusFromProvider(utilitybills.ProviderOutcomePending); got != utilitybills.StatusProviderPending {
		t.Fatalf("pending mapped to %s — must be provider_pending", got)
	}
	// A TIMEOUT is folded into 'pending' BEFORE the status mapping runs.
	folded := utilitybills.ClassifyProviderOutcome(true, utilitybills.ProviderOutcomeFailed)
	if folded != utilitybills.ProviderOutcomePending {
		t.Fatalf("a timed-out attempt classified as %s — must be pending", folded)
	}
	if got := utilitybills.NextStatusFromProvider(folded); got != utilitybills.StatusProviderPending {
		t.Fatalf("timed-out attempt landed in %s — must be provider_pending", got)
	}
}

// ── INVARIANT 5: only definitively-settled states are terminal ──────────────

func TestInvariant_TerminalAndReversibleStates(t *testing.T) {
	terminal := map[utilitybills.Status]bool{
		utilitybills.StatusSuccessful: true,
		utilitybills.StatusFailed:     true,
		utilitybills.StatusReversed:   true,
	}
	for _, s := range []utilitybills.Status{
		utilitybills.StatusInitiated, utilitybills.StatusWalletDebited,
		utilitybills.StatusProviderPending, utilitybills.StatusSuccessful,
		utilitybills.StatusFailed, utilitybills.StatusReversed, utilitybills.StatusDisputed,
	} {
		if got := utilitybills.IsTerminalStatus(s); got != terminal[s] {
			t.Fatalf("IsTerminalStatus(%s) = %t, want %t", s, got, terminal[s])
		}
	}

	// A SUCCESSFUL transaction must never be reversible by the generic path: the
	// member got what they paid for. Refunding it is a dispute, not a reversal.
	if utilitybills.CanReverseTransaction(utilitybills.StatusSuccessful) {
		t.Fatal("a successful transaction must not be reversible")
	}
	if utilitybills.CanReverseTransaction(utilitybills.StatusReversed) {
		t.Fatal("an already-reversed transaction must not be reversible again (double refund)")
	}
	for _, s := range []utilitybills.Status{
		utilitybills.StatusFailed, utilitybills.StatusProviderPending, utilitybills.StatusWalletDebited,
	} {
		if !utilitybills.CanReverseTransaction(s) {
			t.Fatalf("%s must be reversible — the member is debited with nothing delivered", s)
		}
	}
}

// ── INVARIANT 6: requery is only offered where it can change anything ──────

func TestInvariant_RequeryOnlyForUnsettledStates(t *testing.T) {
	requeryable := map[utilitybills.Status]bool{
		utilitybills.StatusProviderPending: true,
		utilitybills.StatusWalletDebited:   true,
		utilitybills.StatusInitiated:       true,
	}
	for _, s := range []utilitybills.Status{
		utilitybills.StatusInitiated, utilitybills.StatusWalletDebited,
		utilitybills.StatusProviderPending, utilitybills.StatusSuccessful,
		utilitybills.StatusFailed, utilitybills.StatusReversed, utilitybills.StatusDisputed,
	} {
		if got := utilitybills.CanRequeryStatus(s); got != requeryable[s] {
			t.Fatalf("CanRequeryStatus(%s) = %t, want %t", s, got, requeryable[s])
		}
	}
}

// ── INVARIANT 7: routing never returns a route it filtered out ─────────────

func TestInvariant_SelectProviderNeverReturnsAnIneligibleRoute(t *testing.T) {
	cands := []utilitybills.RouteCandidate{
		{
			Provider: utilitybills.Provider{
				ID: "down", Status: utilitybills.ProviderStatusActive, HealthStatus: utilitybills.HealthDown,
				SupportedCategories: []utilitybills.Category{utilitybills.CategoryElectricity}, Priority: 1,
			},
			Mapping:  utilitybills.ProviderMapping{Status: utilitybills.MappingStatusActive},
			Priority: 1,
		},
	}
	if _, err := utilitybills.SelectProvider(cands, utilitybills.CategoryElectricity); !errors.Is(err, utilitybills.ErrNoViableRoute) {
		t.Fatalf("a down provider was selected: %v", err)
	}
}

// ── INVARIANT 8: the commission convenience-fee override conserves the delta ─
//
// Whatever the override does to what the CUSTOMER pays, it must move gross profit
// by exactly the same amount. Any other relationship would silently create or
// destroy margin.

func TestInvariant_ConvenienceFeeOverrideConservesDelta(t *testing.T) {
	base := utilitybills.Pricing{
		AmountKobo: 500_000, MarkupKobo: 7_500, ConvenienceFeeKobo: 10_000,
		RetailAmountKobo: 517_500, ProviderCostKobo: 490_000, GrossProfitKobo: 27_500,
	}
	for _, override := range []int64{0, 1, 5_000, 10_000, 25_000, 1_000_000} {
		got := utilitybills.ApplyCommissionConvenienceFee(base, override, true)
		deltaRetail := got.RetailAmountKobo - base.RetailAmountKobo
		deltaProfit := got.GrossProfitKobo - base.GrossProfitKobo
		deltaFee := got.ConvenienceFeeKobo - base.ConvenienceFeeKobo
		if deltaRetail != deltaFee || deltaProfit != deltaFee {
			t.Fatalf("override %d: fee moved %d but retail moved %d and profit moved %d",
				override, deltaFee, deltaRetail, deltaProfit)
		}
		if got.AmountKobo != base.AmountKobo || got.ProviderCostKobo != base.ProviderCostKobo {
			t.Fatalf("override %d: the bill amount or provider cost moved — only the fee may", override)
		}
	}
}
