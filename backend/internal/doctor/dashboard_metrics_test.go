package doctor

import (
	"math"
	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/settlement"
	"testing"
)

// dashboard_metrics_test.go — the two pieces of dashboard arithmetic that need no
// database: what a doctor's share of an escrowed consult is, and how a rating
// becomes a satisfaction percentage.

func TestConsultSplitMirrorsTelemedicine(t *testing.T) {
	// The split telemedicine.CompleteAppointment pays (service.go:700-704) is the
	// money the doctor actually gets. If either side drifts, this fails.
	if consultProviderPct+consultPlatformPct != 1.0 {
		t.Fatalf("consult split %.2f + %.2f != 1.0", consultProviderPct, consultPlatformPct)
	}
	cases := []struct {
		name         string
		total, fee   int64
		wantProvider int64
	}{
		// 200000 escrowed, no booking fee → 85% of it all.
		{"no booking fee", 200000, 0, 170000},
		// ADR-044: the 2000 platform booking fee is 100% platform and rides ON TOP,
		// so the doctor keeps 85% of the 198000 consult, not of the total.
		{"with booking fee", 200000, 2000, 168300},
		// Pre-ADR-044 rows escrowed the consult alone.
		{"legacy row", 750000, 0, 637500},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := pendingConsultKobo(c.total, c.fee)
			if err != nil {
				t.Fatalf("pendingConsultKobo: %v", err)
			}
			if got != c.wantProvider {
				t.Errorf("provider kobo = %d, want %d", got, c.wantProvider)
			}
			// Same answer from the shared definition, not a copy of it.
			legs, err := settlement.ComputeLegs(c.total, settlement.Split{
				ProviderPct: consultProviderPct, PlatformPct: consultPlatformPct, ServiceFeeKobo: c.fee,
			})
			if err != nil {
				t.Fatalf("ComputeLegs: %v", err)
			}
			if legs.ProviderKobo != got {
				t.Errorf("pendingConsultKobo %d disagrees with ComputeLegs %d", got, legs.ProviderKobo)
			}
		})
	}
}

func TestDashboardSatisfactionPct(t *testing.T) {
	cases := []struct {
		name string
		in   ReputationSummary
		want *float64
	}{
		// No reviews is NOT zero percent. The tile shows '—'; a 0 here would tell a
		// doctor their brand-new practice scores nothing.
		{"no reviews is nil", ReputationSummary{AverageRating: 0, ReviewCount: 0}, nil},
		{"4.8 of 5 is 96", ReputationSummary{AverageRating: 4.8, ReviewCount: 24}, ptr.Of(96.0)},
		{"4,5,5 rounds to 93", ReputationSummary{AverageRating: 4.6666666666666665, ReviewCount: 3}, ptr.Of(93.0)},
		{"perfect", ReputationSummary{AverageRating: 5, ReviewCount: 1}, ptr.Of(100.0)},
		{"one star is not nil", ReputationSummary{AverageRating: 1, ReviewCount: 2}, ptr.Of(20.0)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := dashboardSatisfactionPct(c.in)
			if c.want == nil {
				if got != nil {
					t.Fatalf("got %v, want nil", *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("got nil, want %v", *c.want)
			}
			if math.Abs(*got-*c.want) > 1e-9 {
				t.Errorf("got %v, want %v", *got, *c.want)
			}
		})
	}
}
