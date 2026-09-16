package settlement_test

import (
	"testing"

	"spotlight/backend/internal/finance/settlement"
)

// ---------------------------------------------------------------------------
// ProviderFeeKobo — a fixed amount paid 100% to the PROVIDER on top of the
// percentage split. The provider-side mirror of ServiceFeeKobo (100% platform)
// and TipKobo (100% rider).
//
// Motivating case: the restaurant takeaway packaging fee. The restaurant buys
// the packs, so the fee is a cost pass-through — the platform and the rider must
// take no cut of it, exactly as the restaurant takes no cut of a rider's tip.
//
// These call settlement.ComputeLegs, which is the SAME function Service.Settle
// uses. That matters: the pre-existing invariant tests re-implement the formula
// locally, so a change to the production expression could not fail them. Tests
// that mirror the code under test only prove the mirror.
// ---------------------------------------------------------------------------

const (
	pctProvider = 0.80
	pctPlatform = 0.10
	pctRider    = 0.10
)

func riderRef(s string) *string { return &s }

func baseSplit() settlement.Split {
	return settlement.Split{
		ProviderID:  "restaurant-owner",
		ProviderPct: pctProvider,
		PlatformPct: pctPlatform,
		RiderID:     riderRef("rider-1"),
		RiderPct:    pctRider,
	}
}

func TestProviderFeePassesWholeToProvider(t *testing.T) {
	// ₦400 of food + ₦600 packaging (3 packs × ₦200), escrowed together.
	const food = 40000
	const packaging = 60000
	total := int64(food + packaging)

	sp := baseSplit()
	sp.ProviderFeeKobo = packaging

	legs, err := settlement.ComputeLegs(total, sp)
	if err != nil {
		t.Fatalf("ComputeLegs: %v", err)
	}

	// The percentages must price the FOOD only. If packaging leaked into the
	// gross, platform would take 10% of it (₦60) and the rider another ₦60.
	wantPlatform := int64(float64(food) * pctPlatform)
	wantRider := int64(float64(food) * pctRider)
	wantProvider := total - wantPlatform - wantRider

	if legs.PlatformKobo != wantPlatform {
		t.Errorf("platform = %d, want %d — platform must take no cut of the packaging fee", legs.PlatformKobo, wantPlatform)
	}
	if legs.RiderKobo != wantRider {
		t.Errorf("rider = %d, want %d — rider must take no cut of the packaging fee", legs.RiderKobo, wantRider)
	}
	if legs.ProviderKobo != wantProvider {
		t.Errorf("provider = %d, want %d", legs.ProviderKobo, wantProvider)
	}

	// The provider's own percentage share of the food, PLUS the whole fee.
	wantProviderShare := int64(float64(food)*pctProvider) + packaging
	if legs.ProviderKobo != wantProviderShare {
		t.Errorf("provider = %d, want %d (80%% of food + all packaging)", legs.ProviderKobo, wantProviderShare)
	}
}

func TestProviderFeeConservesTheEscrowedTotal(t *testing.T) {
	// The money invariant: legs sum to exactly what was escrowed, never more or
	// less, across every combination of the flat legs.
	cases := []struct {
		name                          string
		total, tip, service, provider int64
	}{
		{"packaging only", 100000, 0, 0, 60000},
		{"packaging + tip", 150000, 20000, 0, 60000},
		{"packaging + service fee", 150000, 0, 15000, 60000},
		{"all three", 200000, 20000, 15000, 60000},
		{"packaging is the whole order", 60000, 0, 0, 60000},
		{"no packaging (unchanged behaviour)", 100000, 0, 0, 0},
		{"odd kobo that cannot split evenly", 99999, 333, 777, 4321},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sp := baseSplit()
			sp.TipKobo = c.tip
			sp.ServiceFeeKobo = c.service
			sp.ProviderFeeKobo = c.provider

			legs, err := settlement.ComputeLegs(c.total, sp)
			if err != nil {
				t.Fatalf("ComputeLegs: %v", err)
			}
			sum := legs.ProviderKobo + legs.PlatformKobo + legs.RiderKobo
			if sum != c.total {
				t.Errorf("legs sum to %d, escrowed total is %d (leak of %d)", sum, c.total, sum-c.total)
			}
			if legs.ProviderKobo < 0 || legs.PlatformKobo < 0 || legs.RiderKobo < 0 {
				t.Errorf("negative leg: provider=%d platform=%d rider=%d", legs.ProviderKobo, legs.PlatformKobo, legs.RiderKobo)
			}
		})
	}
}

func TestProviderFeeDefaultsToUnchangedBehaviour(t *testing.T) {
	// Every existing caller (telemedicine, mobility, the doctor split) leaves
	// ProviderFeeKobo at zero. Those splits must come out byte-identical, or this
	// change silently reprices other modules.
	total := int64(123456)
	sp := baseSplit()
	sp.TipKobo = 5000
	sp.ServiceFeeKobo = 7000

	withZero := sp
	withZero.ProviderFeeKobo = 0

	a, err := settlement.ComputeLegs(total, sp)
	if err != nil {
		t.Fatalf("ComputeLegs: %v", err)
	}
	b, err := settlement.ComputeLegs(total, withZero)
	if err != nil {
		t.Fatalf("ComputeLegs: %v", err)
	}
	if a != b {
		t.Errorf("zero provider fee changed the split: %+v vs %+v", a, b)
	}
}

func TestProviderFeeIsBoundedByTheEscrowedTotal(t *testing.T) {
	// A fee larger than what was escrowed would drive the gross negative and
	// hand the provider money nobody paid. Fail closed.
	sp := baseSplit()
	sp.ProviderFeeKobo = 100001

	if _, err := settlement.ComputeLegs(100000, sp); err == nil {
		t.Fatal("expected an error when the provider fee exceeds the escrowed total")
	}

	// And in combination with the other flat legs.
	sp2 := baseSplit()
	sp2.TipKobo = 40000
	sp2.ServiceFeeKobo = 40000
	sp2.ProviderFeeKobo = 40000
	if _, err := settlement.ComputeLegs(100000, sp2); err == nil {
		t.Fatal("expected an error when tip + service fee + provider fee exceed the total")
	}
}

func TestProviderFeeRejectsNegative(t *testing.T) {
	sp := baseSplit()
	sp.ProviderFeeKobo = -1
	if err := sp.Validate(); err == nil {
		t.Fatal("expected Validate to reject a negative provider fee")
	}
}

func TestProviderFeeWithNoRider(t *testing.T) {
	// A restaurant order can settle before a rider is assigned (pickup, or a
	// cancelled dispatch). The packaging fee must still reach the restaurant.
	const food = 50000
	const packaging = 40000
	sp := settlement.Split{
		ProviderID:      "restaurant-owner",
		ProviderPct:     0.90,
		PlatformPct:     0.10,
		ProviderFeeKobo: packaging,
	}

	legs, err := settlement.ComputeLegs(food+packaging, sp)
	if err != nil {
		t.Fatalf("ComputeLegs: %v", err)
	}
	if legs.RiderKobo != 0 {
		t.Errorf("rider = %d, want 0 with no rider", legs.RiderKobo)
	}
	wantPlatform := int64(float64(food) * 0.10)
	if legs.PlatformKobo != wantPlatform {
		t.Errorf("platform = %d, want %d", legs.PlatformKobo, wantPlatform)
	}
	if got, want := legs.ProviderKobo, int64(food+packaging)-wantPlatform; got != want {
		t.Errorf("provider = %d, want %d", got, want)
	}
}
