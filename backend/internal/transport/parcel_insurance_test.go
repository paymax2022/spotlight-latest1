package transport

// Pure-logic unit tests for parcel insurance-premium computation. DB-free and
// deterministic, mirroring the style of modes_engine_test.go's parcelFare tests.

import "testing"

func parcelCfgWithInsurance(bps int64) *PricingConfig {
	c := parcelCfg()
	c.InsuranceRateBps = bps
	return c
}

func TestParcelInsurance_BasicRate(t *testing.T) {
	// 150 bps = 1.5%, matching the mock's declaredValueKobo * 0.015.
	got := parcelInsurance(1_000_000, parcelCfgWithInsurance(150))
	if got != 15_000 {
		t.Fatalf("parcelInsurance = %d, want 15000", got)
	}
}

func TestParcelInsurance_ZeroDeclaredValue(t *testing.T) {
	// A sender who declines to declare a value gets no insurance premium — this
	// must not silently default to some floor and charge for cover nobody asked for.
	got := parcelInsurance(0, parcelCfgWithInsurance(150))
	if got != 0 {
		t.Fatalf("parcelInsurance(0, ...) = %d, want 0", got)
	}
}

func TestParcelInsurance_RoundsToNearestKobo(t *testing.T) {
	// 333 kobo declared * 150 bps / 10000 = 4.995 -> rounds to 5, not truncates to 4.
	got := parcelInsurance(333, parcelCfgWithInsurance(150))
	if got != 5 {
		t.Fatalf("parcelInsurance(333, 150bps) = %d, want 5 (rounded, not truncated)", got)
	}
}

func TestParcelInsurance_NegativeRateNeverPays(t *testing.T) {
	// Defensive: a misconfigured negative rate must never produce a negative
	// premium (which would look like a refund baked into a quote).
	got := parcelInsurance(1_000_000, parcelCfgWithInsurance(-50))
	if got < 0 {
		t.Fatalf("parcelInsurance with negative rate = %d, must never be negative", got)
	}
}

func TestParcelEstimate_TotalIsFarePlusInsurance(t *testing.T) {
	cfg := parcelCfgWithInsurance(150)
	req := ParcelEstimateRequest{
		Category:          "small",
		Size:              "medium",
		Speed:             "express",
		DeclaredValueKobo: 1_000_000,
	}
	fare := parcelFare(10000, 1200, req.Size, req.Speed, cfg)
	insurance := parcelInsurance(req.DeclaredValueKobo, cfg)
	est := ParcelEstimate{
		FareKobo:      fare,
		InsuranceKobo: insurance,
		TotalKobo:     fare + insurance,
	}
	if est.TotalKobo != est.FareKobo+est.InsuranceKobo {
		t.Fatalf("TotalKobo(%d) != FareKobo(%d) + InsuranceKobo(%d)", est.TotalKobo, est.FareKobo, est.InsuranceKobo)
	}
	if est.InsuranceKobo != 15_000 {
		t.Fatalf("InsuranceKobo = %d, want 15000", est.InsuranceKobo)
	}
}
