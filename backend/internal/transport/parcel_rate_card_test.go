package transport

import (
	"context"
	"testing"
)

// The app offers Standard / Express / Priority. Priority is sent as
// "same_day"; it used to fall through to the standard multiplier, so it was
// priced BELOW Express (and its booking then broke the parcels.speed CHECK).
func TestParcelSpeed_PriorityIsPricedAboveExpress(t *testing.T) {
	cfg := parcelCfg()
	express := parcelFare(10000, 1200, "small", "express", cfg)
	priority := parcelFare(10000, 1200, "small", "same_day", cfg)
	if priority <= express {
		t.Fatalf("priority fare %d must be above express fare %d", priority, express)
	}
}

func TestNormalizeParcelSpeed(t *testing.T) {
	cases := map[string]string{
		"":          "standard",
		"standard":  "standard",
		"EXPRESS":   "express",
		"priority":  "same_day",
		"same_day":  "same_day",
		"scheduled": "scheduled",
	}
	for in, want := range cases {
		if got := normalizeParcelSpeed(in); got != want {
			t.Errorf("normalizeParcelSpeed(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParcelFareWithRate_AppliesMultiplierAndTheHigherMinimum(t *testing.T) {
	cfg := parcelCfg() // base 40000, per km 9000, per min 1500, min 100000
	// 10km, 20min: 40000 + 90000 + 30000 = 160000 raw.
	if got := parcelFareWithRate(10000, 1200, parcelRate{MultiplierBps: 15000}, cfg); got != 240000 {
		t.Fatalf("1.5x fare = %d, want 240000", got)
	}
	// A tiny trip: the rate's own minimum beats the config minimum.
	if got := parcelFareWithRate(40, 10, parcelRate{MultiplierBps: 22000, MinFareKobo: 300000}, cfg); got != 300000 {
		t.Fatalf("priority minimum = %d, want 300000", got)
	}
	// A rate minimum below the config minimum never undercuts the config.
	if got := parcelFareWithRate(40, 10, parcelRate{MultiplierBps: 10000, MinFareKobo: 50000}, cfg); got != 100000 {
		t.Fatalf("config minimum = %d, want 100000", got)
	}
	// A broken (zero/negative) multiplier is treated as 1x, never a free or negative fare.
	if got := parcelFareWithRate(10000, 1200, parcelRate{MultiplierBps: 0}, cfg); got != 160000 {
		t.Fatalf("zero multiplier fare = %d, want 160000 (1x)", got)
	}
}

func TestParcelPriceOptions_CoverEverySizeAndSpeedInOrder(t *testing.T) {
	cfg := parcelCfg()
	card := parcelRateCard{
		"small/standard": {MultiplierBps: 10000, MinFareKobo: 100000},
		"small/express":  {MultiplierBps: 15000, MinFareKobo: 180000},
		"small/same_day": {MultiplierBps: 22000, MinFareKobo: 300000},
	}
	opts := parcelPriceOptions(10000, 1200, cfg, card)
	if len(opts) != len(parcelSizes)*len(parcelOfferedSpeeds) {
		t.Fatalf("got %d options, want %d", len(opts), len(parcelSizes)*len(parcelOfferedSpeeds))
	}
	if opts[0].Size != "small" || opts[0].Speed != "standard" || opts[0].FareKobo != 160000 {
		t.Fatalf("first option = %+v, want small/standard 160000", opts[0])
	}
	// Cells missing from the card fall back to the legacy multipliers.
	for _, o := range opts {
		if o.Size == "large" && o.Speed == "express" {
			if want := parcelFare(10000, 1200, "large", "express", cfg); o.FareKobo != want {
				t.Fatalf("large/express = %d, want legacy %d", o.FareKobo, want)
			}
		}
	}
	// Within each size, faster is never cheaper.
	for i := 0; i+2 < len(opts); i += 3 {
		if !(opts[i].FareKobo <= opts[i+1].FareKobo && opts[i+1].FareKobo <= opts[i+2].FareKobo) {
			t.Fatalf("speeds not monotonic for %s: %d %d %d", opts[i].Size, opts[i].FareKobo, opts[i+1].FareKobo, opts[i+2].FareKobo)
		}
	}
}

func TestParcelIndicativeInsurance_HonoursTheProviderMinimum(t *testing.T) {
	s := &Service{parcelInsuranceMinKobo: 200000}
	cfg := parcelCfgWithInsurance(50)
	if got := s.parcelIndicativeInsurance(context.Background(), 0, cfg); got != 0 {
		t.Fatalf("no declared value = %d, want 0 (cover declined)", got)
	}
	// 0.5% of ₦10,000 is ₦50, but the provider's floor is ₦2,000.
	if got := s.parcelIndicativeInsurance(context.Background(), 1_000_000, cfg); got != 200000 {
		t.Fatalf("small declared value = %d, want the 200000 floor", got)
	}
	// 0.5% of ₦1,000,000 is ₦5,000, above the floor.
	if got := s.parcelIndicativeInsurance(context.Background(), 100_000_000, cfg); got != 500000 {
		t.Fatalf("large declared value = %d, want 500000", got)
	}
}

// A card checkout is charged the quote frozen at initiate; an admin editing the
// rate card before confirm must not change what the booking recomputes.
func TestPriceParcelFrozen_ReplaysTheFrozenRate(t *testing.T) {
	s := &Service{parcelRateCardOn: true}
	rate := parcelRate{MultiplierBps: 22000, MinFareKobo: 300000}
	frozen := &parcelFrozenPricing{DistanceM: 10000, DurationS: 1200, Config: *parcelCfg(), Rate: &rate}
	pr, err := s.priceParcelFrozen(context.Background(), ParcelBookRequest{Size: "small", Speed: "same_day"}, frozen)
	if err != nil {
		t.Fatalf("priceParcelFrozen: %v", err)
	}
	if want := parcelFareWithRate(10000, 1200, rate, parcelCfg()); pr.fare != want {
		t.Fatalf("fare = %d, want frozen-rate fare %d", pr.fare, want)
	}
	if pr.rate == nil || *pr.rate != rate {
		t.Fatalf("priced rate = %+v, want the frozen %+v", pr.rate, rate)
	}
}

// An intent frozen before the rate card existed carries no rate: it must be
// priced with the legacy multipliers it was quoted with.
func TestPriceParcelFrozen_LegacySnapshotUsesLegacyMultipliers(t *testing.T) {
	s := &Service{parcelRateCardOn: true}
	frozen := &parcelFrozenPricing{DistanceM: 10000, DurationS: 1200, Config: *parcelCfg()}
	pr, err := s.priceParcelFrozen(context.Background(), ParcelBookRequest{Size: "medium", Speed: "express"}, frozen)
	if err != nil {
		t.Fatalf("priceParcelFrozen: %v", err)
	}
	if want := parcelFare(10000, 1200, "medium", "express", parcelCfg()); pr.fare != want {
		t.Fatalf("fare = %d, want legacy %d", pr.fare, want)
	}
}

// The wallet path escrows the fare BEFORE inserting the parcel, so a value the
// parcels CHECKs reject must be refused while pricing, never after the money
// has moved.
func TestPriceParcelWith_RefusesValuesTheTableWouldReject(t *testing.T) {
	s := &Service{}
	route := RouteResult{DistanceM: 10000, DurationS: 1200}
	for _, req := range []ParcelBookRequest{
		{Size: "huge", Speed: "standard", Category: "documents"},
		{Size: "small", Speed: "turbo", Category: "documents"},
		{Size: "small", Speed: "standard", Category: "weapons"},
	} {
		if _, err := s.priceParcelWith(context.Background(), req, parcelCfg(), route, nil); err == nil {
			t.Errorf("%+v priced; want a validation error before any escrow", req)
		}
	}
}

func TestPriceParcelWith_NormalisesCase(t *testing.T) {
	s := &Service{}
	route := RouteResult{DistanceM: 10000, DurationS: 1200}
	pr, err := s.priceParcelWith(context.Background(), ParcelBookRequest{Size: "Medium", Speed: "Priority", Category: "Documents"}, parcelCfg(), route, nil)
	if err != nil {
		t.Fatalf("priceParcelWith: %v", err)
	}
	if pr.size != "medium" || pr.speed != "same_day" || pr.category != "documents" {
		t.Fatalf("normalised to %s/%s/%s, want medium/same_day/documents", pr.size, pr.speed, pr.category)
	}
	if want := parcelFare(10000, 1200, "medium", "same_day", parcelCfg()); pr.fare != want {
		t.Fatalf("fare = %d, want %d (medium, not the 1x default)", pr.fare, want)
	}
}
